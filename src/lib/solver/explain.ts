// "Why this person?" for one shift of a solved rota: who holds it, how their week looks around it,
// and for every other staff member the first hard rule that would stop them taking it instead.
// Uses the same rule order and phrases as the solver's uncovered-shift blockers (findBlocker).

import type { BlockReason, Role, Shift, SolveInput, SolveResult } from "@/lib/domain/types";
import { effectiveCaps, findBlocker } from "./availability";

export interface RestGap {
  hours: number; // real elapsed hours (DST-aware)
  otherShiftId: string;
}

export interface ShiftAssignee {
  staffId: string;
  pinned: boolean;
  pinReason?: string;
  weekHours: number; // their total hours in the final rota
  cap: number; // their effective weekly hours cap
  restBefore: RestGap | null; // gap from the end of their previous shift to this one
  restAfter: RestGap | null; // gap from the end of this shift to their next one
}

export interface Candidate {
  staffId: string;
  status: "assigned" | "blocked" | "free";
  reason?: BlockReason;
  detail: string;
  quote?: string;
  constraintId?: string;
}

export interface ShiftExplanation {
  shiftId: string;
  role: Role;
  hours: number;
  assignee: ShiftAssignee | null;
  candidates: Candidate[]; // every staff member, sorted by staff id
}

const HOUR_MS = 3_600_000;
const ms = (instant: string) => Date.parse(instant);
const round2 = (x: number) => Math.round(x * 100) / 100;
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function explainShift(input: SolveInput, result: SolveResult, shiftId: string): ShiftExplanation {
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const shift = shiftById.get(shiftId);
  if (!shift) throw new Error(`Unknown shift ${shiftId}`);

  const constraints = [...input.constraints].sort((a, b) => cmpStr(a.id, b.id));
  const staff = [...input.staff].sort((a, b) => cmpStr(a.id, b.id));
  const shiftsOf = (staffId: string): Shift[] =>
    result.assignments
      .filter((a) => a.staffId === staffId)
      .map((a) => shiftById.get(a.shiftId))
      .filter((s): s is Shift => s !== undefined)
      .sort((a, b) => ms(a.start) - ms(b.start) || cmpStr(a.id, b.id));

  const onShift = result.assignments.filter((a) => a.shiftId === shiftId).sort((a, b) => cmpStr(a.staffId, b.staffId));
  const pinReason = (staffId: string) => input.pins.filter((p) => p.shiftId === shiftId && p.staffId === staffId).map((p) => p.reason).sort()[0];

  let assignee: ShiftAssignee | null = null;
  const first = onShift[0];
  if (first) {
    const person = staff.find((p) => p.id === first.staffId);
    const theirs = shiftsOf(first.staffId);
    const others = theirs.filter((t) => t.id !== shiftId);
    const before = others.filter((t) => ms(t.start) < ms(shift.start)).at(-1);
    const after = others.find((t) => ms(t.start) >= ms(shift.start));
    const reason = first.pinned ? pinReason(first.staffId) : undefined;
    assignee = {
      staffId: first.staffId,
      pinned: first.pinned,
      ...(reason !== undefined ? { pinReason: reason } : {}),
      weekHours: round2(theirs.reduce((sum, t) => sum + Math.round(t.hours * 100), 0) / 100),
      cap: person ? effectiveCaps(person, constraints, input.rulePack).maxHours : 0,
      restBefore: before ? { hours: round2((ms(shift.start) - ms(before.end)) / HOUR_MS), otherShiftId: before.id } : null,
      restAfter: after ? { hours: round2((ms(after.start) - ms(shift.end)) / HOUR_MS), otherShiftId: after.id } : null,
    };
  }

  const candidates: Candidate[] = staff.map((person): Candidate => {
    const mine = onShift.find((a) => a.staffId === person.id);
    if (mine) {
      const reason = mine.pinned ? pinReason(person.id) : undefined;
      return { staffId: person.id, status: "assigned", detail: mine.pinned ? (reason ? `pinned: ${reason}` : "pinned") : "on this shift" };
    }
    // Against the final rota with the current assignee taken off this shift: the person keeps their
    // own shifts, and this shift is not among them.
    const blocker = findBlocker(person, shift, shiftsOf(person.id), constraints, input.rulePack, input.timezone);
    if (!blocker) return { staffId: person.id, status: "free", detail: onShift.length > 0 ? "free, but not chosen" : "free" };
    const c: Candidate = { staffId: person.id, status: "blocked", reason: blocker.reason, detail: blocker.detail };
    if (blocker.quote !== undefined) c.quote = blocker.quote;
    if (blocker.constraintId !== undefined) c.constraintId = blocker.constraintId;
    return c;
  });

  return { shiftId, role: shift.role, hours: shift.hours, assignee, candidates };
}
