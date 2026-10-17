import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { weekDates } from "@/lib/domain/time";
import { ApiError, notFound } from "./http";
import { constraintView, loadWeek, solveBundle, type ConstraintRow } from "./week";

const WINDOW_KINDS = ["unavailable", "available", "prefer", "prefer_not"];
const CAP_KINDS = ["max_shifts", "max_hours"];

/** Loads a constraint the caller owns (through its week's workspace); otherwise 404. */
export async function loadConstraint(db: Db, userId: string, id: string) {
  const [row] = await db
    .select({ c: t.constraints, weekId: t.weeks.id, status: t.weeks.status })
    .from(t.constraints)
    .innerJoin(t.weeks, eq(t.weeks.id, t.constraints.weekId))
    .innerJoin(t.workspaces, eq(t.workspaces.id, t.weeks.workspaceId))
    .where(and(eq(t.constraints.id, id), eq(t.workspaces.ownerId, userId)));
  if (!row) throw notFound("No such constraint.");
  if (row.status === "published") throw new ApiError(409, "published", "This week is published. Its constraints are locked.");
  return row.c;
}

/** Why a constraint can't count yet, or null if it is complete. */
export function incompleteReason(c: Pick<ConstraintRow, "kind" | "staffId" | "dateFrom" | "value">): string | null {
  if (!c.staffId) return "Choose who this is about first.";
  if (WINDOW_KINDS.includes(c.kind)) return c.dateFrom ? null : "Choose the day first.";
  if (CAP_KINDS.includes(c.kind)) return c.value != null && c.value > 0 ? null : "Enter the cap first.";
  return "Turn this into a constraint first: pick a kind, a person and a day.";
}

export async function decide(db: Db, userId: string, id: string, status: "confirmed" | "rejected") {
  const c = await loadConstraint(db, userId, id);
  if (status === "confirmed") {
    const why = incompleteReason(c);
    if (why) throw new ApiError(422, "incomplete", why);
  }
  const [updated] = await db.update(t.constraints).set({ status, decidedAt: new Date() }).where(eq(t.constraints.id, c.id)).returning();
  const bundle = await loadWeek(db, userId, c.weekId);
  return { constraint: constraintView(updated), solution: solveBundle(bundle) };
}

/** Confirms every proposed constraint in the week (or just the ids given). Ask items stay. */
export async function confirmAll(db: Db, userId: string, weekId: string, ids?: string[]) {
  const bundle = await loadWeek(db, userId, weekId);
  if (bundle.week.status === "published") throw new ApiError(409, "published", "This week is published.");
  const targets = bundle.constraints.filter((c) => c.status === "proposed" && (!ids || ids.includes(c.id)) && !incompleteReason(c));
  if (targets.length) {
    await db.update(t.constraints).set({ status: "confirmed", decidedAt: new Date() }).where(inArray(t.constraints.id, targets.map((c) => c.id)));
  }
  const after = await loadWeek(db, userId, weekId);
  return { confirmed: targets.length, constraints: targets.map((c) => c.id), solution: solveBundle(after) };
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 h).");
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const ConstraintPatch = z.object({
  staffId: z.string().optional(),
  kind: z.enum(["unavailable", "available", "prefer", "prefer_not", "max_shifts", "max_hours"]).optional(),
  dateFrom: LocalDate.nullable().optional(),
  dateTo: LocalDate.nullable().optional(),
  timeFrom: HHMM.nullable().optional(),
  timeTo: HHMM.nullable().optional(),
  daily: z.boolean().optional(),
  shiftLabel: z.string().nullable().optional(),
  value: z.number().positive().max(80).nullable().optional(),
});

/** Inline edit by the manager. The edit is re-checked against the week; it never confirms on its own. */
export async function patchConstraint(db: Db, userId: string, id: string, patch: z.infer<typeof ConstraintPatch>) {
  const c = await loadConstraint(db, userId, id);
  const bundle = await loadWeek(db, userId, c.weekId);
  const next = { ...c, ...patch };
  const dates = weekDates(bundle.week.weekStart);
  const issues: { path: string; message: string }[] = [];
  if (next.staffId && !bundle.staff.some((s) => s.id === next.staffId)) issues.push({ path: "staffId", message: "Not on this team." });
  for (const key of ["dateFrom", "dateTo"] as const) {
    const d = next[key];
    if (d && (d < dates[0] || d > dates[6])) issues.push({ path: key, message: `Pick a day between ${dates[0]} and ${dates[6]}.` });
  }
  if (next.dateFrom && next.dateTo && next.dateTo < next.dateFrom) issues.push({ path: "dateTo", message: "Ends before it starts." });
  if (next.shiftLabel && !bundle.shifts.some((s) => s.label === next.shiftLabel)) issues.push({ path: "shiftLabel", message: "No shift with that label this week." });
  if (issues.length) throw new ApiError(422, "validation_failed", "Some fields are invalid.", issues);

  const checks = [...(c.checks ?? []).filter((k) => k.name !== ("edited" as string)), { name: "edited", ok: true, detail: "Edited by the manager" }];
  const status = c.status === "confirmed" ? "confirmed" : incompleteReason(next) ? "ask" : "proposed";
  const [updated] = await db
    .update(t.constraints)
    .set({ ...patch, dateTo: next.dateTo ?? next.dateFrom ?? null, status, checks, askReason: status === "ask" ? incompleteReason(next) : null })
    .where(eq(t.constraints.id, c.id))
    .returning();
  return { constraint: constraintView(updated) };
}
