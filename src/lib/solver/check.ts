// Independent rota checker. Recomputes every hard rule of docs/DOMAIN.md from the assignments alone,
// with plain pairwise loops. It deliberately does NOT import the solver or availability.ts: the
// constraint semantics are re-implemented here in the simplest way, so a bug in one shows up as a
// disagreement with the other (the property tests rely on that).
//
// Not checked here: that every pin is kept. Violation.rule has no member for it; the solver applies
// pins before search and the tests assert they survive.

import type { Assignment, ResolvedConstraint, Shift, SolveInput, StaffMember, Violation } from "@/lib/domain/types";
import { formatDay, formatHours, overlaps } from "@/lib/domain/time";

const HOUR_MS = 3_600_000;
const EPS = 1e-9;

type Win = { staffId: string; kind: string; start: string; end: string; shiftLabel?: string | null; sentAt: string; quote: string; id: string };

function sameLabel(label: string | null | undefined, shift: Shift): boolean {
  return label == null || label.trim() === "" || label.trim().toLowerCase() === shift.label.trim().toLowerCase();
}

function shiftName(shift: Shift): string {
  return `${formatDay(shift.localDate)} ${shift.label}`;
}

/**
 * Is `shift` blocked for the person by unavailability `u`, after the person's later "available"
 * windows (`laterAvailable`) are carved out? Blocked means some instant of shift ∩ u is not inside
 * any available window. If such an instant exists, the first one is the start of the intersection
 * or the end of one of the available windows, so only those points need testing.
 */
function blockedBy(shift: Shift, u: Win, laterAvailable: Win[]): boolean {
  const from = Math.max(Date.parse(shift.start), Date.parse(u.start));
  const to = Math.min(Date.parse(shift.end), Date.parse(u.end));
  if (from >= to) return false;
  const points = [from, ...laterAvailable.map((a) => Date.parse(a.end)).filter((t) => t > from && t < to)];
  for (const t of points) {
    const inside = laterAvailable.some((a) => Date.parse(a.start) <= t && t < Date.parse(a.end));
    if (!inside) return true;
  }
  return false;
}

export function verifyRota(input: SolveInput, rota: Assignment[]): Violation[] {
  const violations: Violation[] = [];
  // Sorted copy, so the result never depends on the order of the input array.
  const pairKey = (a: Assignment) => `${a.shiftId}\u0000${a.staffId}`;
  const assignments = [...rota].sort((a, b) => (pairKey(a) < pairKey(b) ? -1 : pairKey(a) > pairKey(b) ? 1 : 0));
  const shiftById = new Map<string, Shift>(input.shifts.map((s) => [s.id, s]));
  const staffById = new Map<string, StaffMember>(input.staff.map((p) => [p.id, p]));
  const minRest = input.rulePack.minRestHours;

  // double_booked: a shift assigned more than once (to anyone, including the same person twice).
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      if (assignments[i].shiftId !== assignments[j].shiftId) continue;
      const shift = shiftById.get(assignments[i].shiftId);
      const what = shift ? shiftName(shift) : assignments[i].shiftId;
      const same = assignments[i].staffId === assignments[j].staffId;
      violations.push({
        rule: "double_booked",
        staffId: assignments[j].staffId,
        shiftIds: [assignments[i].shiftId],
        detail: same ? `${what} is assigned to ${assignments[j].staffId} twice` : `${what} is assigned to both ${assignments[i].staffId} and ${assignments[j].staffId}`,
      });
    }
  }

  // From here on, each distinct (shift, person) pair counts once.
  const seen = new Set<string>();
  const rows: { shift: Shift; person: StaffMember }[] = [];
  for (const a of assignments) {
    const key = pairKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    const shift = shiftById.get(a.shiftId);
    const person = staffById.get(a.staffId);
    if (!shift || !person) {
      violations.push({
        rule: "role",
        staffId: a.staffId,
        shiftIds: [a.shiftId],
        detail: !shift ? `assignment refers to unknown shift ${a.shiftId}` : `assignment refers to unknown staff member ${a.staffId}`,
      });
      continue;
    }
    rows.push({ shift, person });
  }

  const windows = input.constraints.filter((c) => "start" in c) as Win[];

  for (const { shift, person } of rows) {
    // role
    if (!person.roles.includes(shift.role)) {
      violations.push({ rule: "role", staffId: person.id, shiftIds: [shift.id], detail: `${person.name} is not a ${shift.role} (needed for ${shiftName(shift)})` });
    }
    // unavailable (after later "available" exceptions)
    for (const u of windows) {
      if (u.kind !== "unavailable" || u.staffId !== person.id || !sameLabel(u.shiftLabel, shift)) continue;
      const laterAvailable = windows.filter(
        (a) => a.kind === "available" && a.staffId === person.id && Date.parse(a.sentAt) > Date.parse(u.sentAt) && sameLabel(a.shiftLabel, shift),
      );
      if (blockedBy(shift, u, laterAvailable)) {
        violations.push({ rule: "unavailable", staffId: person.id, shiftIds: [shift.id], detail: `${person.name} is unavailable for ${shiftName(shift)} ("${u.quote}")` });
      }
    }
  }

  // overlap and rest: every pair of one person's shifts.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].person.id !== rows[j].person.id || rows[i].shift.id === rows[j].shift.id) continue;
      const person = rows[i].person;
      const [first, second] = Date.parse(rows[i].shift.start) <= Date.parse(rows[j].shift.start) ? [rows[i].shift, rows[j].shift] : [rows[j].shift, rows[i].shift];
      if (overlaps(first.start, first.end, second.start, second.end)) {
        violations.push({ rule: "overlap", staffId: person.id, shiftIds: [first.id, second.id], detail: `${person.name} is on ${shiftName(first)} and ${shiftName(second)} at the same time` });
        continue;
      }
      const gap = (Date.parse(second.start) - Date.parse(first.end)) / HOUR_MS;
      if (gap < minRest - EPS) {
        violations.push({
          rule: "rest",
          staffId: person.id,
          shiftIds: [first.id, second.id],
          detail: `${person.name} gets only ${formatHours(gap)} rest between ${shiftName(first)} and ${shiftName(second)} (minimum ${formatHours(minRest)})`,
        });
      }
    }
  }

  // per-person totals: per day, weekly hours, weekly shifts.
  for (const person of [...staffById.values()]) {
    const mine = rows.filter((r) => r.person.id === person.id).map((r) => r.shift);
    if (mine.length === 0) continue;

    const dates = [...new Set(mine.map((s) => s.localDate))];
    for (const date of dates) {
      const that = mine.filter((s) => s.localDate === date);
      if (that.length > input.rulePack.maxShiftsPerDay) {
        violations.push({
          rule: "per_day",
          staffId: person.id,
          shiftIds: that.map((s) => s.id),
          detail: `${person.name} has ${that.length} shifts on ${formatDay(date)} (maximum ${input.rulePack.maxShiftsPerDay})`,
        });
      }
    }

    const caps = input.constraints.filter((c) => c.staffId === person.id && (c.kind === "max_hours" || c.kind === "max_shifts")) as Extract<
      ResolvedConstraint,
      { value: number }
    >[];
    let maxHours = Math.min(person.maxHours, input.rulePack.maxHoursDefault);
    let maxShifts = person.maxShifts ?? Infinity;
    for (const c of caps) {
      if (c.kind === "max_hours") maxHours = Math.min(maxHours, c.value);
      else maxShifts = Math.min(maxShifts, c.value);
    }
    const hours = mine.reduce((sum, s) => sum + s.hours, 0);
    if (hours > maxHours + EPS) {
      violations.push({ rule: "max_hours", staffId: person.id, shiftIds: mine.map((s) => s.id), detail: `${person.name} works ${formatHours(hours)}, over the ${formatHours(maxHours)} maximum` });
    }
    if (mine.length > maxShifts) {
      violations.push({ rule: "max_shifts", staffId: person.id, shiftIds: mine.map((s) => s.id), detail: `${person.name} works ${mine.length} shifts, over the maximum of ${maxShifts}` });
    }
  }

  const key = (v: Violation) => `${v.staffId}\u0000${v.rule}\u0000${[...v.shiftIds].join(",")}\u0000${v.detail}`;
  for (const v of violations) v.shiftIds.sort();
  return violations.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
