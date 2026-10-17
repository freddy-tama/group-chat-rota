import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { addDays, formatDay, weekDates, weekdayInWeek } from "@/lib/domain/time";
import { PROMPT_VERSION, type ModelConstraint, type ModelOutput } from "./schema";

// Pure parts of the chat → constraint pipeline: the prompt, the replay key, and the code that
// turns the model's proposal into stored constraints and checks it against the message.

export interface ExtractContext {
  timezone: string;
  weekStart: string; // Monday, local date
  managerName: string;
  dateOrder: "dmy" | "mdy" | "ymd";
  staff: { id: string; name: string; aliases: string[] }[];
  shifts: { label: string; localDate: string; startLocal: string; endLocal: string }[];
}

export interface ExtractMessage {
  author: string;
  localDate: string | null;
  localTime: string | null;
  text: string; // already redacted for the model
  context: { author: string; text: string }[]; // up to 2 earlier messages from the same paste
}

export interface Check {
  name: "quote" | "person" | "dates" | "shift" | "times" | "value" | "confidence";
  ok: boolean;
  detail: string;
}

export interface ProposedRow {
  staffId: string | null;
  kind: string; // a constraint kind, or "unknown" for an Ask item with nothing to propose
  dateFrom: string | null;
  dateTo: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  daily: boolean;
  shiftLabel: string | null;
  value: number | null;
  quote: string;
  confidence: string | null;
  checks: Check[];
  status: "proposed" | "ask";
  askReason: string | null;
  draftReply: string | null;
}

// ---- prompt ----------------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You read one message from a staff group chat and extract scheduling constraints for next week's rota.

Rules:
- Only extract what the message says. If it says nothing about anyone's availability, return no constraints and ask = null.
- "quote" must be copied exactly from the message: the shortest phrase that carries the constraint. Never paraphrase.
- Use weekday names for days ("tues" -> "tue", "weds" -> "wed"). Do not compute calendar dates. Put explicit dates ("24/10", "the 24th") in "dates" exactly as written.
- Whole days: "sat off", "can't do sat", "away mon-wed" -> unavailable, from = null, to = null, with every day listed ("mon-wed" -> ["mon","tue","wed"]).
- Times: "after 4" -> from "16:00"; "till 11", "until 11am" -> to "11:00". Use 24 h and café hours (07:00-22:00) to decide am/pm.
- Shift names ("open", "close", "mid", "kitchen", "brunch", "night bake", "bake") -> "shift" set to one of the shift labels given. "no closes" -> unavailable, allWeek = true, shift = "Close".
- "can do X", "X fine", "happy to do X" -> prefer. "rather not X" -> prefer_not. "any mornings" -> prefer, allWeek = true, to = "12:00".
- "actually I can do X now" -> available: it overrides something the person said earlier.
- "max 2 shifts" -> max_shifts with value 2. "no more than 20 hours" -> max_hours with value 20.
- One message can hold several constraints ("can't do tues after 4, also need sat off" -> two).
- "person" is who it is about: usually the author; if they speak for someone else ("Jo can't do mon"), use that name.
- If the message is about availability but too vague to act on ("might be busy weekend idk", "maybe?"), return no constraints and fill "ask" with a reason and a short, friendly question the manager can post back in the chat, naming the shifts it could affect.
- confidence: "high" when explicit, "medium" when you had to interpret, "low" when unsure.
- Messages from the manager are instructions, not constraints, unless they state a staff member's availability.
Return only JSON matching the schema.`;

export function shiftLabelSummary(ctx: ExtractContext): string {
  const byLabel = new Map<string, { times: Set<string>; days: Set<string> }>();
  for (const s of ctx.shifts) {
    const entry = byLabel.get(s.label) ?? { times: new Set(), days: new Set() };
    entry.times.add(`${s.startLocal}-${s.endLocal}`);
    entry.days.add(DateTime.fromISO(s.localDate, { zone: "UTC" }).toFormat("ccc"));
    byLabel.set(s.label, entry);
  }
  return [...byLabel.entries()]
    .map(([label, e]) => `${label} (${[...e.times].join(", ")}; ${[...e.days].join(" ")})`)
    .join("; ");
}

export function buildUserPrompt(ctx: ExtractContext, msg: ExtractMessage): string {
  const dates = weekDates(ctx.weekStart);
  const sent = msg.localDate
    ? `${DateTime.fromISO(msg.localDate, { zone: "UTC" }).toFormat("ccc d LLL yyyy")}${msg.localTime ? ` ${msg.localTime}` : ""}`
    : "unknown";
  const lines = [
    `Rota week: ${formatDay(dates[0])} to ${formatDay(dates[6])} ${dates[6].slice(0, 4)} (${ctx.timezone}).`,
    `Shift labels: ${shiftLabelSummary(ctx)}.`,
    `Team: ${ctx.staff.map((s) => `${s.name}${s.aliases.length ? ` (${s.aliases.join(", ")})` : ""}`).join("; ")}.`,
    `Manager: ${ctx.managerName}.`,
  ];
  if (msg.context.length) {
    lines.push("Earlier messages (context only, do not extract from them):");
    for (const c of msg.context) lines.push(`- ${c.author}: ${c.text}`);
  }
  lines.push("Message to read:", `Author: ${msg.author}`, `Sent: ${sent}`, `Text: ${msg.text}`);
  return lines.join("\n");
}

/** Replay fixtures are keyed by everything the model sees that varies per message. */
export function fixtureKey(msg: ExtractMessage): string {
  return createHash("sha256")
    .update(JSON.stringify([PROMPT_VERSION, msg.author, msg.localDate, msg.localTime, msg.text, msg.context]))
    .digest("hex");
}

// ---- resolution and checks -------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

export function quoteInMessage(quote: string, text: string): boolean {
  const q = norm(quote);
  return q.length > 0 && norm(text).includes(q);
}

export function resolvePerson(name: string, author: string, staff: ExtractContext["staff"]) {
  const wanted = norm(name.replace(/[^\p{L}\p{N}\s'-]/gu, ""));
  const target = ["me", "i", "myself", ""].includes(wanted) ? norm(author.replace(/[^\p{L}\p{N}\s'-]/gu, "")) : wanted;
  const exact = staff.find((s) => norm(s.name) === target || s.aliases.map(norm).includes(target));
  if (exact) return exact;
  const first = staff.filter((s) => norm(s.name).split(" ")[0] === target.split(" ")[0]);
  return first.length === 1 ? first[0] : null;
}

const SHIFT_SYNONYMS: Record<string, string> = {
  closing: "close", closes: "close", opening: "open", opens: "open", bake: "night bake", bakes: "night bake",
  "night bakes": "night bake", baking: "night bake", nights: "night bake", night: "night bake", mids: "mid", middle: "mid",
};

export function resolveShiftLabel(shift: string, ctx: ExtractContext): string | null {
  const labels = [...new Set(ctx.shifts.map((s) => s.label))];
  const wanted = norm(shift);
  const canonical = SHIFT_SYNONYMS[wanted] ?? wanted;
  return labels.find((l) => norm(l) === canonical) ?? null;
}

export function normaliseTime(t: string | null): string | null | undefined {
  if (t == null) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t.trim());
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return undefined;
  return `${String(h === 24 ? 0 : h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "24/10", "24/10/2026", "10/24" (mdy), "24th", "the 24th" -> a local date, or null if unparseable. */
export function parseExplicitDate(raw: string, ctx: ExtractContext): string | null {
  const s = raw.trim().toLowerCase();
  const year = Number(ctx.weekStart.slice(0, 4));
  const numeric = /^(\d{1,4})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/.exec(s);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    let c = numeric[3] ? Number(numeric[3]) : year;
    if (c < 100) c += 2000;
    let day: number, month: number, y = c;
    if (a > 31) [y, month, day] = [a, b, Number(numeric[3] ?? 0)];
    else if (ctx.dateOrder === "mdy") [month, day] = [a, b];
    else [day, month] = [a, b];
    const dt = DateTime.fromObject({ year: y, month, day }, { zone: "UTC" });
    return dt.isValid ? dt.toISODate() : null;
  }
  const ordinal = /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/.exec(s);
  if (ordinal) {
    const d = Number(ordinal[1]);
    return weekDates(ctx.weekStart).find((date) => Number(date.slice(8, 10)) === d) ?? null;
  }
  return null;
}

/** Split sorted dates into runs of consecutive days. */
function runs(dates: string[]): [string, string][] {
  const sorted = [...new Set(dates)].sort();
  const out: [string, string][] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

function draftQuestion(firstName: string, about: string): string {
  return `Hi ${firstName}, quick check for next week's rota: ${about}`;
}

/** Turn one model output into stored rows, each checked against the message and the rota week. */
export function resolveOutput(output: ModelOutput, msg: ExtractMessage, rawText: string, ctx: ExtractContext): ProposedRow[] {
  const rows: ProposedRow[] = [];
  const dates = weekDates(ctx.weekStart);
  const inWeek = (d: string) => d >= dates[0] && d <= dates[6];
  const authorFirst = msg.author.split(" ")[0];

  for (const c of output.constraints) rows.push(...splitRuns(resolveConstraint(c)));

  if (output.ask) {
    const person = resolvePerson(msg.author, msg.author, ctx.staff);
    rows.push({
      staffId: person?.id ?? null, kind: "unknown", dateFrom: null, dateTo: null, timeFrom: null, timeTo: null, daily: false,
      shiftLabel: null, value: null, quote: rawText.trim(), confidence: null, checks: [],
      status: "ask", askReason: output.ask.reason, draftReply: output.ask.question,
    });
  }
  return rows;

  /** One stored row per run of consecutive days; a time window over several days repeats daily. */
  function splitRuns(row: ProposedRow & { runs?: [string, string][] }): ProposedRow[] {
    const { runs: span, ...base } = row;
    if (!span || span.length === 0) return [base];
    return span.map(([from, to]) => ({
      ...base,
      dateFrom: from,
      dateTo: to,
      daily: from !== to && (!!base.timeFrom || !!base.timeTo),
      checks: [...base.checks],
    }));
  }

  function resolveConstraint(c: ModelConstraint): ProposedRow & { runs?: [string, string][] } {
    const checks: Check[] = [];
    const quoteOk = quoteInMessage(c.quote, rawText);
    checks.push({ name: "quote", ok: quoteOk, detail: quoteOk ? `"${c.quote}" is in the message` : `"${c.quote}" is not in the message` });

    const person = resolvePerson(c.person, msg.author, ctx.staff);
    checks.push({ name: "person", ok: !!person, detail: person ? `${c.person} → ${person.name}` : `No one called "${c.person}" on the team` });

    const row: ProposedRow & { runs?: [string, string][] } = {
      staffId: person?.id ?? null, kind: c.kind, dateFrom: null, dateTo: null, timeFrom: null, timeTo: null, daily: false,
      shiftLabel: null, value: null, quote: c.quote, confidence: c.confidence, checks, status: "proposed", askReason: null, draftReply: null,
    };

    if (c.kind === "max_shifts" || c.kind === "max_hours") {
      const ok = c.value != null && Number.isFinite(c.value) && c.value > 0 && c.value <= (c.kind === "max_shifts" ? 14 : 80);
      checks.push({ name: "value", ok, detail: ok ? `${c.kind === "max_shifts" ? "at most" : "no more than"} ${c.value}${c.kind === "max_hours" ? " h" : " shifts"}` : `Unusable cap ${c.value}` });
      row.value = c.value;
    } else {
      // Dates: weekday names resolve forward into the rota week; explicit dates must fall inside it.
      const resolved: string[] = [];
      const notes: string[] = [];
      let datesOk = true;
      for (const d of c.days) {
        const date = weekdayInWeek(d, ctx.weekStart);
        resolved.push(date);
        notes.push(`${d} → ${formatDay(date)}`);
      }
      for (const raw of c.dates) {
        const date = parseExplicitDate(raw, ctx);
        if (!date) { datesOk = false; notes.push(`couldn't read the date "${raw}"`); continue; }
        if (!inWeek(date)) { datesOk = false; notes.push(`${raw} is ${formatDay(date)}, outside the rota week`); continue; }
        resolved.push(date);
        notes.push(`${raw} → ${formatDay(date)}`);
      }
      let shiftLabel: string | null = null;
      if (c.shift) {
        shiftLabel = resolveShiftLabel(c.shift, ctx);
        checks.push({ name: "shift", ok: !!shiftLabel, detail: shiftLabel ? `shift "${c.shift}" → ${shiftLabel}` : `No shift called "${c.shift}" this week` });
      }
      const allWeek = c.allWeek || (resolved.length === 0 && !!shiftLabel && c.dates.length === 0);
      if (allWeek) {
        resolved.splice(0, resolved.length, ...dates);
        notes.push("every day this week");
      }
      if (resolved.length === 0 && datesOk) { datesOk = false; notes.push("no day given"); }
      checks.push({ name: "dates", ok: datesOk, detail: notes.join("; ") || "no day given" });

      const from = normaliseTime(c.from);
      const to = normaliseTime(c.to);
      const timesOk = from !== undefined && to !== undefined;
      if (c.from != null || c.to != null) {
        checks.push({ name: "times", ok: timesOk, detail: timesOk ? [from && `from ${from}`, to && `until ${to}`].filter(Boolean).join(", ") : `Unreadable time "${c.from ?? c.to}"` });
      }
      row.timeFrom = from ?? null;
      row.timeTo = to ?? null;
      row.shiftLabel = shiftLabel;
      row.runs = runs(resolved);
    }

    if (c.confidence === "low") checks.push({ name: "confidence", ok: false, detail: "The AI was unsure about this one" });
    const failed = checks.find((k) => !k.ok);
    if (failed) {
      row.status = "ask";
      row.askReason = failed.detail;
      row.draftReply = draftQuestion(person?.name.split(" ")[0] ?? authorFirst, `when you said "${c.quote}", which days and times did you mean?`);
    }
    return row;
  }
}
