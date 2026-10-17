import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { addDays, crossesClockChange, dayWindow, localToInstant, shiftInstants } from "@/lib/domain/time";
import type { ResolvedConstraint, RulePack, Shift, SolveInput, SolveResult, StaffMember, Role } from "@/lib/domain/types";
import { solve } from "@/lib/solver/solve";
import { explainShift } from "@/lib/solver/explain";
import { ApiError, notFound } from "./http";

export type ConstraintRow = typeof t.constraints.$inferSelect;
export type MessageRow = typeof t.messages.$inferSelect;

export interface WeekBundle {
  workspace: typeof t.workspaces.$inferSelect;
  week: typeof t.weeks.$inferSelect;
  staff: (typeof t.staff.$inferSelect)[];
  shifts: (typeof t.shifts.$inferSelect)[];
  pins: (typeof t.pins.$inferSelect)[];
  messages: MessageRow[];
  constraints: ConstraintRow[];
  rulePacks: (typeof t.rulePacks.$inferSelect)[];
  history: (typeof t.fairnessHistory.$inferSelect)[];
}

/** Loads a week the caller owns. Someone else's week is a 404, never a 403, so ids don't leak. */
export async function loadWeek(db: Db, userId: string, weekId: string): Promise<WeekBundle> {
  const [row] = await db
    .select({ week: t.weeks, workspace: t.workspaces })
    .from(t.weeks)
    .innerJoin(t.workspaces, eq(t.workspaces.id, t.weeks.workspaceId))
    .where(and(eq(t.weeks.id, weekId), eq(t.workspaces.ownerId, userId)));
  if (!row) throw notFound("No such week in your workspaces.");
  return loadWeekUnchecked(db, row.workspace, row.week);
}

export async function loadWeekUnchecked(db: Db, workspace: WeekBundle["workspace"], week: WeekBundle["week"]): Promise<WeekBundle> {
  const [staff, shifts, pins, messages, constraints, rulePacks, history] = await Promise.all([
    db.select().from(t.staff).where(eq(t.staff.workspaceId, workspace.id)).orderBy(asc(t.staff.key)),
    db.select().from(t.shifts).where(eq(t.shifts.weekId, week.id)).orderBy(asc(t.shifts.key)),
    db.select().from(t.pins).where(eq(t.pins.weekId, week.id)),
    db.select().from(t.messages).where(eq(t.messages.weekId, week.id)).orderBy(asc(t.messages.seq)),
    db.select().from(t.constraints).where(eq(t.constraints.weekId, week.id)).orderBy(asc(t.constraints.createdAt), asc(t.constraints.id)),
    db.select().from(t.rulePacks).where(eq(t.rulePacks.workspaceId, workspace.id)).orderBy(asc(t.rulePacks.version)),
    db.select().from(t.fairnessHistory).where(eq(t.fairnessHistory.workspaceId, workspace.id)),
  ]);
  return { workspace, week, staff, shifts, pins, messages, constraints, rulePacks, history };
}

export async function loadWorkspace(db: Db, userId: string, workspaceId: string) {
  const [ws] = await db.select().from(t.workspaces).where(and(eq(t.workspaces.id, workspaceId), eq(t.workspaces.ownerId, userId)));
  if (!ws) throw notFound("No such workspace.");
  return ws;
}

// ---- rule packs ------------------------------------------------------------------------------

export function activeRulePack(bundle: WeekBundle): RulePack & { id: string; source: string | null } {
  const eligible = bundle.rulePacks.filter((p) => p.effectiveFrom <= bundle.week.weekStart);
  const pack = eligible.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0];
  if (!pack) throw new ApiError(409, "no_rule_pack", "No rule pack is in effect for this week.");
  return {
    id: pack.id, name: pack.name, version: pack.version, effectiveFrom: pack.effectiveFrom, minRestHours: pack.minRestHours,
    maxHoursDefault: pack.maxHoursDefault, maxShiftsPerDay: pack.maxShiftsPerDay, source: pack.source,
  };
}

// ---- mapping to the solver -------------------------------------------------------------------

export function shiftView(row: WeekBundle["shifts"][number], zone: string): Shift & { dbId: string; crossesClockChange: boolean } {
  const { start, end, hours } = shiftInstants(row.localDate, row.startLocal, row.endLocal, zone);
  return {
    id: row.key, dbId: row.id, label: row.label, role: row.role as Role, localDate: row.localDate, startLocal: row.startLocal,
    endLocal: row.endLocal, start, end, hours, crossesClockChange: crossesClockChange(start, end, zone),
  };
}

/** A stored (local-terms) constraint -> solver constraints with UTC windows. */
export function toResolved(row: ConstraintRow, zone: string, staffKey: string, sentAt: string): ResolvedConstraint[] {
  const base = { staffId: staffKey, sentAt, quote: row.quote };
  if (row.kind === "max_shifts" || row.kind === "max_hours") {
    if (row.value == null) return [];
    return [{ id: row.id, kind: row.kind, value: row.value, ...base }];
  }
  if (!["unavailable", "available", "prefer", "prefer_not"].includes(row.kind) || !row.dateFrom) return [];
  const kind = row.kind as "unavailable" | "available" | "prefer" | "prefer_not";
  const dateTo = row.dateTo ?? row.dateFrom;
  const windowOn = (from: string, to: string) => ({
    start: row.timeFrom ? localToInstant(from, row.timeFrom, zone) : dayWindow(from, zone).start,
    end: row.timeTo ? localToInstant(to, row.timeTo, zone) : dayWindow(to, zone).end,
  });
  if (row.daily) {
    const out: ResolvedConstraint[] = [];
    for (let d = row.dateFrom, i = 0; d <= dateTo; d = addDays(d, 1), i++) {
      out.push({ id: `${row.id}#${i}`, kind, ...windowOn(d, d), shiftLabel: row.shiftLabel, ...base } as ResolvedConstraint);
    }
    return out;
  }
  return [{ id: row.id, kind, ...windowOn(row.dateFrom, dateTo), shiftLabel: row.shiftLabel, ...base } as ResolvedConstraint];
}

export function buildSolveInput(bundle: WeekBundle): SolveInput {
  const zone = bundle.workspace.timezone;
  const keyOf = new Map(bundle.staff.map((s) => [s.id, s.key]));
  const shiftKeyOf = new Map(bundle.shifts.map((s) => [s.id, s.key]));
  const sentAtOf = new Map(bundle.messages.map((m) => [m.id, m.sentAt?.toISOString() ?? null]));
  const staff: StaffMember[] = bundle.staff.map((s) => ({
    id: s.key, name: s.name, aliases: s.aliases, roles: s.roles as Role[], maxHours: s.maxHours, maxShifts: s.maxShifts, hourlyRate: s.hourlyRate,
  }));
  const constraints = bundle.constraints
    .filter((c) => c.status === "confirmed" && c.staffId && keyOf.has(c.staffId))
    .flatMap((c) => {
      const sentAt = (c.messageId && sentAtOf.get(c.messageId)) || (c.decidedAt ?? c.createdAt).toISOString();
      return toResolved(c, zone, keyOf.get(c.staffId!)!, sentAt);
    });
  return {
    timezone: zone,
    weekStart: bundle.week.weekStart,
    shifts: bundle.shifts.map((s) => {
      const { dbId, crossesClockChange, ...shift } = shiftView(s, zone);
      void dbId;
      void crossesClockChange;
      return shift;
    }),
    staff,
    constraints,
    pins: bundle.pins
      .filter((p) => keyOf.has(p.staffId) && shiftKeyOf.has(p.shiftId))
      .map((p) => ({ shiftId: shiftKeyOf.get(p.shiftId)!, staffId: keyOf.get(p.staffId)!, reason: p.reason })),
    rulePack: activeRulePack(bundle),
    history: bundle.history.filter((h) => keyOf.has(h.staffId)).map((h) => ({ staffId: keyOf.get(h.staffId)!, weeks: h.weeks, closes: h.closes, weekends: h.weekends, nights: h.nights })),
  };
}

/** Solver output with keys translated back to database ids for the API and the UI. */
export interface SolutionView extends Omit<SolveResult, "assignments" | "uncovered" | "totals" | "violations"> {
  assignments: { shiftId: string; staffId: string; pinned: boolean }[];
  uncovered: (Omit<SolveResult["uncovered"][number], "shiftId" | "blockers"> & {
    shiftId: string;
    blockers: (Omit<SolveResult["uncovered"][number]["blockers"][number], "staffId" | "otherShiftId"> & { staffId: string; otherShiftId?: string })[];
  })[];
  totals: (Omit<SolveResult["totals"][number], "staffId"> & { staffId: string })[];
  violations: (Omit<SolveResult["violations"][number], "staffId" | "shiftIds"> & { staffId: string; shiftIds: string[] })[];
  rulePack: { id: string; name: string; version: number; effectiveFrom: string; minRestHours: number; maxHoursDefault: number; source: string | null };
  solvedInMs: number;
}

export function solveBundle(bundle: WeekBundle): SolutionView {
  const input = buildSolveInput(bundle);
  const started = performance.now();
  const result = solve(input);
  const solvedInMs = Math.round((performance.now() - started) * 10) / 10;
  const staffId = new Map(bundle.staff.map((s) => [s.key, s.id]));
  const shiftId = new Map(bundle.shifts.map((s) => [s.key, s.id]));
  const pack = activeRulePack(bundle);
  return {
    ...result,
    assignments: result.assignments.map((a) => ({ shiftId: shiftId.get(a.shiftId)!, staffId: staffId.get(a.staffId)!, pinned: a.pinned })),
    uncovered: result.uncovered.map((u) => ({
      ...u,
      shiftId: shiftId.get(u.shiftId)!,
      blockers: u.blockers.map((b) => ({ ...b, staffId: staffId.get(b.staffId)!, otherShiftId: b.otherShiftId ? shiftId.get(b.otherShiftId) : undefined })),
    })),
    totals: result.totals.map((x) => ({ ...x, staffId: staffId.get(x.staffId)! })),
    violations: result.violations.map((v) => ({ ...v, staffId: staffId.get(v.staffId) ?? v.staffId, shiftIds: v.shiftIds.map((s) => shiftId.get(s) ?? s) })),
    rulePack: { id: pack.id, name: pack.name, version: pack.version, effectiveFrom: pack.effectiveFrom, minRestHours: pack.minRestHours, maxHoursDefault: pack.maxHoursDefault, source: pack.source },
    solvedInMs,
  };
}

/** The full week as the board needs it. */
export function weekView(bundle: WeekBundle) {
  const zone = bundle.workspace.timezone;
  const solution = bundle.week.status === "published" && bundle.week.publishedSolution
    ? (bundle.week.publishedSolution as SolutionView)
    : solveBundle(bundle);
  return {
    workspace: { id: bundle.workspace.id, name: bundle.workspace.name, timezone: zone, managerName: bundle.workspace.managerName, isDemo: bundle.workspace.isDemo, dateOrder: bundle.workspace.dateOrder },
    week: { id: bundle.week.id, weekStart: bundle.week.weekStart, status: bundle.week.status, publishedAt: bundle.week.publishedAt },
    rulePack: solution.rulePack,
    staff: bundle.staff.map((s) => ({ id: s.id, key: s.key, name: s.name, aliases: s.aliases, roles: s.roles, maxHours: s.maxHours, maxShifts: s.maxShifts })),
    shifts: bundle.shifts.map((s) => {
      const v = shiftView(s, zone);
      return { id: s.id, key: s.key, label: v.label, role: v.role, localDate: v.localDate, startLocal: v.startLocal, endLocal: v.endLocal, start: v.start, end: v.end, hours: v.hours, crossesClockChange: v.crossesClockChange };
    }),
    pins: bundle.pins.map((p) => ({ shiftId: p.shiftId, staffId: p.staffId, reason: p.reason })),
    messages: bundle.messages.map((m) => ({ id: m.id, seq: m.seq, author: m.author, staffId: m.staffId, text: m.text, sentAt: m.sentAt?.toISOString() ?? null, timestampBasis: m.timestampBasis, sourceApp: m.sourceApp })),
    constraints: bundle.constraints.map(constraintView),
    counts: {
      confirmed: bundle.constraints.filter((c) => c.status === "confirmed").length,
      proposed: bundle.constraints.filter((c) => c.status === "proposed").length,
      ask: bundle.constraints.filter((c) => c.status === "ask").length,
    },
    solution,
  };
}

export function constraintView(c: ConstraintRow) {
  return {
    id: c.id, messageId: c.messageId, staffId: c.staffId, kind: c.kind, dateFrom: c.dateFrom, dateTo: c.dateTo, timeFrom: c.timeFrom,
    timeTo: c.timeTo, daily: c.daily, shiftLabel: c.shiftLabel, value: c.value, quote: c.quote, status: c.status, origin: c.origin,
    confidence: c.confidence, checks: c.checks, askReason: c.askReason, draftReply: c.draftReply,
  };
}

/** "Why this person?" for one shift, with keys translated back to database ids. */
export function explainBundle(bundle: WeekBundle, shiftDbId: string) {
  const row = bundle.shifts.find((s) => s.id === shiftDbId);
  if (!row) throw notFound("No such shift in this week.");
  const input = buildSolveInput(bundle);
  const result = solve(input);
  const why = explainShift(input, result, row.key);
  const staffId = new Map(bundle.staff.map((s) => [s.key, s.id]));
  const shiftId = new Map(bundle.shifts.map((s) => [s.key, s.id]));
  const gap = (g: { hours: number; otherShiftId: string } | null) => (g ? { hours: g.hours, otherShiftId: shiftId.get(g.otherShiftId)! } : null);
  return {
    shiftId: row.id,
    role: why.role,
    hours: why.hours,
    crossesClockChange: shiftView(row, bundle.workspace.timezone).crossesClockChange,
    assignee: why.assignee ? { ...why.assignee, staffId: staffId.get(why.assignee.staffId)!, restBefore: gap(why.assignee.restBefore), restAfter: gap(why.assignee.restAfter) } : null,
    candidates: why.candidates.map((c) => ({ ...c, staffId: staffId.get(c.staffId)! })),
  };
}
