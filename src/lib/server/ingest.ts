import { randomUUID } from "node:crypto";
import { and, eq, gt, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { preparseChat, redactForModel, type PreparseResult } from "@/lib/chat/preparse";
import { instantToLocalDate, instantToLocalTime } from "@/lib/domain/time";
import { fixtureKey, resolveOutput, resolvePerson, type ExtractContext, type ExtractMessage, type ProposedRow } from "@/lib/ai/extract";
import { aiMode, aiModel, lookupFixture, runAll, runExtraction, worstCaseUsd, type AiResult } from "@/lib/ai/run";
import { PROMPT_VERSION } from "@/lib/ai/schema";
import { reserveBudget, settleBudget } from "./budget";
import { ApiError } from "./http";
import { constraintView, loadWeek, solveBundle, type WeekBundle } from "./week";

export const PasteBody = z.object({
  text: z.string().max(20_000, "That paste is too long; paste one week of messages at a time."),
  consent: z.literal(true, { message: "Confirm your team agreed to have these messages processed." }),
  dateOrder: z.enum(["dmy", "mdy"]).optional(),
});

const MAX_MESSAGES = 60;
const LIVE_CALLS_PER_HOUR = 120;
const HOUR_LIMIT_REASON = "This workspace has used its AI quota for the hour.";
const BUDGET_REASON = {
  total: "The live demo has used its AI budget. Write this one yourself.",
  day: "The live demo has used today's AI budget (it resets at midnight UTC). Write this one yourself.",
} as const;

export function extractContext(bundle: WeekBundle, dateOrder: "dmy" | "mdy" | "ymd"): ExtractContext {
  return {
    timezone: bundle.workspace.timezone,
    weekStart: bundle.week.weekStart,
    managerName: bundle.workspace.managerName,
    dateOrder,
    staff: bundle.staff.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases })),
    shifts: bundle.shifts.map((s) => ({ label: s.label, localDate: s.localDate, startLocal: s.startLocal, endLocal: s.endLocal })),
  };
}

/** Parse only: what the pre-parser makes of a paste, with no AI and no storage. */
export function parseOnly(text: string, timezone: string, dateOrder?: "dmy" | "mdy"): PreparseResult {
  return preparseChat(text, { timezone, defaultDateOrder: dateOrder ?? "dmy", anchor: new Date().toISOString() });
}

export async function ingestPaste(db: Db, userId: string, weekId: string, input: z.infer<typeof PasteBody>) {
  const bundle = await loadWeek(db, userId, weekId);
  if (bundle.week.status === "published") throw new ApiError(409, "published", "This week is published. Start next week's rota to add messages.");
  if (!input.text.trim()) throw new ApiError(422, "empty_paste", "Paste at least one message.");

  const parsed = parseOnly(input.text, bundle.workspace.timezone, input.dateOrder ?? (bundle.workspace.dateOrder as "dmy" | "mdy"));
  if (parsed.messages.length === 0) throw new ApiError(422, "no_messages", "No chat messages found in that paste. Each line should start with a name, like \"Sam: can't do tues\".");
  if (parsed.messages.length > MAX_MESSAGES) throw new ApiError(422, "too_many_messages", `That's ${parsed.messages.length} messages; paste at most ${MAX_MESSAGES} at a time.`);

  const ctx = extractContext(bundle, parsed.dateOrder.value);
  const [{ seq }] = await db.select({ seq: max(t.messages.seq) }).from(t.messages).where(eq(t.messages.weekId, weekId));
  const hourAgo = new Date(Date.now() - 3600_000);
  const [{ live }] = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(t.aiCalls)
    .where(and(eq(t.aiCalls.workspaceId, bundle.workspace.id), eq(t.aiCalls.mode, "live"), gt(t.aiCalls.createdAt, hourAgo)));

  const batchId = randomUUID();
  const items = parsed.messages.map((m, i) => {
    const redacted = redactForModel(m.text);
    const localDate = m.localDate ?? (m.sentAt ? instantToLocalDate(m.sentAt, ctx.timezone) : null);
    const localTime = m.localTime ?? (m.sentAt ? instantToLocalTime(m.sentAt, ctx.timezone) : null);
    const context = parsed.messages.slice(Math.max(0, i - 2), i).map((p) => ({ author: p.author, text: redactForModel(p.text).text }));
    const msg: ExtractMessage = { author: m.author, localDate, localTime, text: redacted.text, context };
    return { parsed: m, msg, redactions: redacted.redactions, id: randomUUID() };
  });

  // Decide up front which messages may call the model: the first ones without a recording, up to
  // this workspace's hourly quota and whatever the site-wide dollar budget can still cover.
  const model = aiMode() === "live" ? aiModel() : null;
  const needsLive = items.map((item) => !!model && !lookupFixture(fixtureKey(item.msg)));
  const hourLeft = Math.max(0, LIVE_CALLS_PER_HOUR - live);
  const asking = items.filter((_, i) => needsLive[i]).slice(0, hourLeft);
  const reservation = await reserveBudget(db, asking.map((item) => worstCaseUsd(model!, ctx, item.msg)));
  let order = 0;
  const permits = needsLive.map((need) => {
    if (!need) return { allowLive: true };
    const n = order++;
    if (n < reservation.granted) return { allowLive: true };
    if (n >= hourLeft) return { allowLive: false, blockedReason: HOUR_LIMIT_REASON };
    return { allowLive: false, blockedReason: BUDGET_REASON[reservation.stoppedBy ?? "total"] };
  });

  // If the run throws, the reservation stays spent: the cap errs on the safe side.
  const results: AiResult[] = await runAll(items, 4, (item, i) => runExtraction(ctx, item.msg, permits[i]));
  await settleBudget(db, reservation, results.reduce((sum, r) => sum + r.costUsd, 0));

  const now = Date.now();
  const messageRows = items.map((item, i) => ({
    id: item.id, weekId, batchId, seq: (seq ?? 0) + i + 1, author: item.parsed.author,
    staffId: resolvePerson(item.parsed.author, item.parsed.author, ctx.staff)?.id ?? null,
    text: item.parsed.text, sentAt: item.parsed.sentAt ? new Date(item.parsed.sentAt) : null,
    timestampBasis: item.parsed.timestamp, sourceApp: parsed.app,
  }));

  const constraintRows: (typeof t.constraints.$inferInsert)[] = [];
  items.forEach((item, i) => {
    const r = results[i];
    let rows: ProposedRow[];
    if (r.output) {
      rows = resolveOutput(r.output, item.msg, item.msg.text, ctx);
    } else {
      rows = [{
        staffId: messageRows[i].staffId, kind: "unknown", dateFrom: null, dateTo: null, timeFrom: null, timeTo: null, daily: false,
        shiftLabel: null, value: null, quote: item.parsed.text, confidence: null, checks: [], status: "ask",
        askReason: r.error ?? "The AI couldn't read this message.", draftReply: null,
      }];
    }
    rows.forEach((row, j) => constraintRows.push({
      id: randomUUID(), weekId, messageId: item.id, staffId: row.staffId, kind: row.kind, dateFrom: row.dateFrom, dateTo: row.dateTo,
      timeFrom: row.timeFrom, timeTo: row.timeTo, daily: row.daily, shiftLabel: row.shiftLabel, value: row.value, quote: row.quote,
      status: row.status, origin: r.source === "live" ? "ai-live" : r.source === "replay" ? "ai-replay" : "manager",
      confidence: row.confidence, checks: row.checks, askReason: row.askReason, draftReply: row.draftReply,
      createdAt: new Date(now + i * 10 + j),
    }));
  });

  await db.transaction(async (tx) => {
    await tx.insert(t.messages).values(messageRows);
    if (constraintRows.length) await tx.insert(t.constraints).values(constraintRows);
    await tx.insert(t.aiCalls).values(items.map((item, i) => ({
      id: randomUUID(), workspaceId: bundle.workspace.id, fixtureKey: results[i].key, mode: results[i].source, model: results[i].model,
      promptVersion: PROMPT_VERSION, output: results[i].output, latencyMs: results[i].latencyMs,
    })));
  });

  const after = await loadWeek(db, userId, weekId);
  const created = new Set(constraintRows.map((c) => c.id));
  return {
    batchId,
    format: { app: parsed.app, dateOrder: parsed.dateOrder, clock: parsed.clock, warnings: parsed.warnings, skipped: parsed.skipped },
    aiMode: aiMode(),
    messages: messageRows.map((m, i) => ({
      id: m.id, seq: m.seq, author: m.author, staffId: m.staffId, text: m.text, sentAt: m.sentAt?.toISOString() ?? null,
      timestampBasis: m.timestampBasis, sourceApp: m.sourceApp,
      ai: { source: results[i].source, model: results[i].model, key: results[i].key, latencyMs: results[i].latencyMs, error: results[i].error, output: results[i].output, redactions: items[i].redactions },
    })),
    constraints: after.constraints.filter((c) => created.has(c.id)).map(constraintView),
    solution: solveBundle(after),
  };
}
