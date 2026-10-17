import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { newShareToken, hashShareToken } from "@/lib/auth";
import { formatDay, formatHours, weekDates } from "@/lib/domain/time";
import { ApiError, notFound } from "./http";
import { loadWeek, loadWeekUnchecked, shiftView, solveBundle, type SolutionView, type WeekBundle } from "./week";

// Publishing locks the week's rota, creates one read-only link per staff member, and writes the
// reply the manager pastes back into the group chat ("chat-back").

export function receiptFor(solution: SolutionView) {
  const gaps = solution.totals.map((x) => x.minRestHours).filter((h): h is number => h != null);
  const minRest = gaps.length ? Math.min(...gaps) : null;
  const shortRests = solution.totals.filter((x) => x.minRestHours != null && x.minRestHours < solution.rulePack.minRestHours).length;
  return {
    covered: solution.coverage.covered,
    total: solution.coverage.total,
    restRuleHours: solution.rulePack.minRestHours,
    shortRestGaps: shortRests,
    minRestHours: minRest,
    violations: solution.violations.length,
    rulePack: `${solution.rulePack.name} v${solution.rulePack.version}`,
    line: `${shortRests} rest gaps under ${solution.rulePack.minRestHours} h · ${solution.coverage.covered}/${solution.coverage.total} covered · ${solution.rulePack.name} v${solution.rulePack.version}`,
  };
}

export function chatBackText(bundle: WeekBundle, solution: SolutionView, links: { staffId: string; url: string }[], baseUrl: string) {
  void baseUrl;
  const zone = bundle.workspace.timezone;
  const staffName = new Map(bundle.staff.map((s) => [s.id, s.name.split(" ")[0]]));
  const byShift = new Map(solution.assignments.map((a) => [a.shiftId, a.staffId]));
  const receipt = receiptFor(solution);
  const lines: string[] = [];
  lines.push(`📋 Rota for w/c ${formatDay(bundle.week.weekStart)} is up. Checked against ${receipt.rulePack}: ${receipt.line.split(" · ").slice(0, 2).join(", ")}.`);
  lines.push("");
  for (const date of weekDates(bundle.week.weekStart)) {
    const dayShifts = bundle.shifts.filter((s) => s.localDate === date).map((s) => shiftView(s, zone)).sort((a, b) => a.start.localeCompare(b.start));
    if (!dayShifts.length) continue;
    const parts = dayShifts.map((s) => `${s.label} ${byShift.has(s.dbId) ? staffName.get(byShift.get(s.dbId)!) : "⚠️ not covered"}`);
    lines.push(`${formatDay(date)}: ${parts.join(" · ")}`);
  }
  for (const u of solution.uncovered) {
    const shift = bundle.shifts.find((s) => s.id === u.shiftId);
    if (!shift) continue;
    const need = u.role === "keyholder" ? "a key holder" : `someone for ${u.role}`;
    lines.push("", `⚠️ Still need ${need} for ${formatDay(shift.localDate)} ${shift.label} (${shift.startLocal}–${shift.endLocal}). Can anyone help?`);
  }
  const asks = bundle.constraints.filter((c) => c.status === "ask" && c.draftReply);
  if (asks.length) {
    lines.push("", "Quick questions:");
    for (const a of asks) lines.push(`• ${a.draftReply}`);
  }
  if (links.length) {
    lines.push("", "Your own shifts and hours (private link each):");
    for (const l of links) lines.push(`• ${staffName.get(l.staffId)}: ${l.url}`);
  }
  return lines.join("\n");
}

export async function publishWeek(db: Db, userId: string, weekId: string, baseUrl: string) {
  const bundle = await loadWeek(db, userId, weekId);
  if (bundle.week.status === "published") throw new ApiError(409, "published", "This week is already published.");
  const solution = solveBundle(bundle);
  const links = bundle.staff.map((s) => ({ staffId: s.id, ...newShareToken() }));
  await db.transaction(async (tx) => {
    await tx.update(t.weeks).set({ status: "published", publishedAt: new Date(), publishedSolution: solution }).where(eq(t.weeks.id, bundle.week.id));
    await tx.insert(t.shareLinks).values(links.map((l) => ({ id: randomUUID(), weekId: bundle.week.id, staffId: l.staffId, tokenHash: l.hash, token: l.token })));
  });
  return publishedView(db, userId, weekId, baseUrl);
}

export async function publishedView(db: Db, userId: string, weekId: string, baseUrl: string) {
  const bundle = await loadWeek(db, userId, weekId);
  if (bundle.week.status !== "published") throw new ApiError(409, "not_published", "Publish the week first.");
  const solution = bundle.week.publishedSolution as SolutionView;
  const rows = await db.select().from(t.shareLinks).where(eq(t.shareLinks.weekId, weekId));
  const order = new Map(bundle.staff.map((s, i) => [s.id, i]));
  const shareLinks = rows
    .sort((a, b) => (order.get(a.staffId) ?? 0) - (order.get(b.staffId) ?? 0))
    .map((r) => ({ staffId: r.staffId, name: bundle.staff.find((s) => s.id === r.staffId)?.name ?? "", token: r.token, url: `${baseUrl}/s/${r.token}` }));
  return {
    week: { id: bundle.week.id, status: bundle.week.status, publishedAt: bundle.week.publishedAt },
    receipt: receiptFor(solution),
    shareLinks,
    chatBack: chatBackText(bundle, solution, shareLinks, baseUrl),
  };
}

/** What one staff member sees through their link: their own shifts only, plus the receipt. */
export async function shareView(db: Db, token: string) {
  const [link] = await db.select().from(t.shareLinks).where(eq(t.shareLinks.tokenHash, hashShareToken(token)));
  if (!link) throw notFound("This link doesn't exist or was replaced.");
  const [week] = await db.select().from(t.weeks).where(eq(t.weeks.id, link.weekId));
  const [workspace] = await db.select().from(t.workspaces).where(eq(t.workspaces.id, week.workspaceId));
  const bundle = await loadWeekUnchecked(db, workspace, week);
  const solution = week.publishedSolution as SolutionView;
  const me = bundle.staff.find((s) => s.id === link.staffId)!;
  const mine = new Set(solution.assignments.filter((a) => a.staffId === me.id).map((a) => a.shiftId));
  const shifts = bundle.shifts
    .filter((s) => mine.has(s.id))
    .map((s) => shiftView(s, workspace.timezone))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((s) => ({ label: s.label, localDate: s.localDate, startLocal: s.startLocal, endLocal: s.endLocal, start: s.start, end: s.end, hours: s.hours, crossesClockChange: s.crossesClockChange }));
  const totals = solution.totals.find((x) => x.staffId === me.id);
  const hours = shifts.reduce((sum, s) => sum + s.hours, 0);
  return {
    staff: { name: me.name },
    workspace: { name: workspace.name, timezone: workspace.timezone },
    week: { weekStart: week.weekStart, publishedAt: week.publishedAt },
    shifts,
    totals: { shifts: shifts.length, hours, hoursLabel: formatHours(hours), maxHours: me.maxHours, minRestHours: totals?.minRestHours ?? null },
    receipt: receiptFor(solution),
  };
}
