// Constraint semantics from docs/DOMAIN.md, as small pure helpers the solver (and the UI) can share.
// The independent checker (check.ts) re-implements the same rules separately on purpose.
//
// Every constraint passed in is a confirmed one (ResolvedConstraint); status filtering happens upstream.
//
// - unavailable: blocks a shift whose interval OVERLAPS the window. With shiftLabel, only shifts with
//   that label (case-insensitive) are blocked.
// - available: carves an exception out of the SAME person's unavailability that was sent strictly
//   EARLIER (by sentAt), for shifts with the label (if given). "Carves out" is taken literally as a
//   set difference of time: the unavailability still blocks the shift if any instant of
//   (shift ∩ unavailable window) is left after removing the windows of all applicable later
//   "available" constraints. For a shift lying inside the available window this is exactly
//   "exception for shifts inside its window"; it also lets two adjacent available windows combine.
//   An available constraint never overrides a later (or same-instant) unavailability.
// - prefer / prefer_not: a shift matches when its START instant lies in [start, end) (and it has the
//   label, if given). "Mornings" is therefore a 00:00-12:00 window per day.
// - max_hours / max_shifts: the effective weekly cap is the minimum of the staff record, the rule
//   pack (hours only) and every such constraint for the person.

import type { Blocker, ResolvedConstraint, Role, RulePack, Shift, StaffMember } from "@/lib/domain/types";
import { addDays, formatDay, formatHours, instantToLocalDate, instantToLocalTime } from "@/lib/domain/time";

export type WindowConstraint = Extract<ResolvedConstraint, { start: string }>;
export type CapConstraint = Extract<ResolvedConstraint, { value: number }>;

export function isWindowConstraint(c: ResolvedConstraint): c is WindowConstraint {
  return c.kind === "unavailable" || c.kind === "available" || c.kind === "prefer" || c.kind === "prefer_not";
}

export function isCapConstraint(c: ResolvedConstraint): c is CapConstraint {
  return c.kind === "max_hours" || c.kind === "max_shifts";
}

const ms = (instant: string) => Date.parse(instant);
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A missing or blank label applies to every shift; otherwise labels compare case-insensitively. */
export function labelApplies(label: string | null | undefined, shift: Shift): boolean {
  if (label == null || label.trim() === "") return true;
  return label.trim().toLowerCase() === shift.label.trim().toLowerCase();
}

/** Does this unavailable/available window touch the shift at all (overlap + label)? */
export function windowTouchesShift(c: WindowConstraint, shift: Shift): boolean {
  return labelApplies(c.shiftLabel, shift) && ms(shift.start) < ms(c.end) && ms(c.start) < ms(shift.end);
}

/** prefer / prefer_not matching: the shift's start instant lies in [start, end), label applies. */
export function preferenceMatches(c: WindowConstraint, shift: Shift): boolean {
  const s = ms(shift.start);
  return labelApplies(c.shiftLabel, shift) && ms(c.start) <= s && s < ms(c.end);
}

/** True when [from, to) is entirely covered by the union of the windows (sweep over sorted windows). */
function coveredByUnion(from: number, to: number, windows: { start: string; end: string }[]): boolean {
  const spans = windows
    .map((w) => [ms(w.start), ms(w.end)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cursor = from;
  for (const [a, b] of spans) {
    if (cursor >= to) break;
    if (a > cursor) return false; // a gap before this window starts
    if (b > cursor) cursor = b;
  }
  return cursor >= to;
}

/**
 * The person's unavailable constraints that still block this shift after available-exceptions,
 * sorted by id. `constraints` may hold anyone's constraints; only staffId's are used.
 */
export function effectiveUnavailability(staffId: string, shift: Shift, constraints: ResolvedConstraint[]): WindowConstraint[] {
  const own = constraints.filter((c): c is WindowConstraint => c.staffId === staffId && isWindowConstraint(c));
  const blocking: WindowConstraint[] = [];
  for (const u of own) {
    if (u.kind !== "unavailable" || !windowTouchesShift(u, shift)) continue;
    const from = Math.max(ms(u.start), ms(shift.start));
    const to = Math.min(ms(u.end), ms(shift.end));
    const exceptions = own.filter((a) => a.kind === "available" && ms(a.sentAt) > ms(u.sentAt) && labelApplies(a.shiftLabel, shift));
    if (!coveredByUnion(from, to, exceptions)) blocking.push(u);
  }
  return blocking.sort(byId);
}

export function isUnavailable(staffId: string, shift: Shift, constraints: ResolvedConstraint[]): boolean {
  return effectiveUnavailability(staffId, shift, constraints).length > 0;
}

/**
 * Human phrase for an unavailability, without the person's name:
 * "unavailable all day Sat 24 Oct", "unavailable from 16:00 on Tue 20 Oct",
 * "unavailable until 11:00 on Fri 23 Oct", "unavailable for Close on Sat 24 Oct".
 */
export function describeUnavailability(c: WindowConstraint, shift: Shift, zone: string): string {
  if (c.shiftLabel != null && c.shiftLabel.trim() !== "") return `unavailable for ${shift.label} on ${formatDay(shift.localDate)}`;
  const startDate = instantToLocalDate(c.start, zone);
  const startTime = instantToLocalTime(c.start, zone);
  const endDate = instantToLocalDate(c.end, zone);
  const endTime = instantToLocalTime(c.end, zone);
  const startsAtMidnight = startTime === "00:00";
  const endsAtMidnight = endTime === "00:00";
  const lastDate = endsAtMidnight ? addDays(endDate, -1) : endDate; // an end at 00:00 closes the previous day
  if (startsAtMidnight && endsAtMidnight) {
    return startDate === lastDate
      ? `unavailable all day ${formatDay(startDate)}`
      : `unavailable all day ${formatDay(startDate)} to ${formatDay(lastDate)}`;
  }
  if (endsAtMidnight && startDate === lastDate) return `unavailable from ${startTime} on ${formatDay(startDate)}`;
  if (startsAtMidnight && startDate === endDate) return `unavailable until ${endTime} on ${formatDay(startDate)}`;
  if (startDate === endDate) return `unavailable ${startTime}–${endTime} on ${formatDay(startDate)}`;
  return `unavailable from ${startTime} ${formatDay(startDate)} to ${endTime} ${formatDay(endDate)}`;
}

export interface BlockingConstraint {
  constraintId: string;
  quote: string;
  detail: string;
}

/** The first (by id) confirmed unavailability that blocks staffId from the shift, or null. */
export function blockingConstraint(
  staffId: string,
  shift: Shift,
  constraints: ResolvedConstraint[],
  zone = "Europe/London",
): BlockingConstraint | null {
  const [first] = effectiveUnavailability(staffId, shift, constraints);
  if (!first) return null;
  return { constraintId: first.id, quote: first.quote, detail: describeUnavailability(first, shift, zone) };
}

/** Preference score of giving this shift to staffId: +1 per prefer matched, -1 per prefer_not matched. */
export function preferenceScore(staffId: string, shift: Shift, constraints: ResolvedConstraint[]): number {
  let score = 0;
  for (const c of constraints) {
    if (c.staffId !== staffId || (c.kind !== "prefer" && c.kind !== "prefer_not")) continue;
    if (preferenceMatches(c, shift)) score += c.kind === "prefer" ? 1 : -1;
  }
  return score;
}

export interface EffectiveCaps {
  maxHours: number;
  maxShifts: number | null; // null = no weekly shift cap
  /** The max_hours constraint that sets maxHours, when it is stricter than the record and the rule pack. */
  hoursConstraint: CapConstraint | null;
  /** The max_shifts constraint that sets maxShifts, when it is stricter than the staff record. */
  shiftsConstraint: CapConstraint | null;
}

export function effectiveCaps(staff: StaffMember, constraints: ResolvedConstraint[], rulePack: RulePack): EffectiveCaps {
  const own = constraints.filter((c): c is CapConstraint => c.staffId === staff.id && isCapConstraint(c));
  const tightest = (kind: CapConstraint["kind"]) =>
    own
      .filter((c) => c.kind === kind)
      .sort((a, b) => a.value - b.value || byId(a, b))[0] ?? null;

  const baseHours = Math.min(staff.maxHours, rulePack.maxHoursDefault);
  const hc = tightest("max_hours");
  const hoursConstraint = hc && hc.value < baseHours ? hc : null;

  const baseShifts = staff.maxShifts ?? Infinity;
  const sc = tightest("max_shifts");
  const shiftsConstraint = sc && sc.value < baseShifts ? sc : null;
  const maxShifts = Math.min(baseShifts, sc?.value ?? Infinity);

  return {
    maxHours: hoursConstraint ? hoursConstraint.value : baseHours,
    maxShifts: Number.isFinite(maxShifts) ? maxShifts : null,
    hoursConstraint,
    shiftsConstraint,
  };
}

const HOUR_MS = 3_600_000;
const centi = (hours: number) => Math.round(hours * 100);

/** "not a key holder", "doesn't work kitchen", ... */
export function roleDetail(role: Role): string {
  switch (role) {
    case "keyholder":
      return "not a key holder";
    case "kitchen":
      return "doesn't work kitchen";
    default:
      return `not a ${role}`;
  }
}

function shiftName(shift: Shift): string {
  return `${formatDay(shift.localDate)} ${shift.label}`;
}

/**
 * The first hard rule that stops `person` taking `shift`, given the other shifts they already work
 * (`theirShifts`, which must not contain `shift`). Order: role, unavailable, overlap, per_day, rest,
 * max_hours, max_shifts. Returns null when nothing stops them. Details never name the person:
 * "unavailable all day Sat 24 Oct", "already on Sat 24 Oct Open", "already working Sat 24 Oct",
 * "only 9.0 h rest after Fri 23 Oct Close", "at max 40.0 h", "at max 2 shifts".
 * Shared by the solver's uncovered-shift blockers and the per-shift explanation.
 */
export function findBlocker(
  person: StaffMember,
  shift: Shift,
  theirShifts: Shift[],
  constraints: ResolvedConstraint[],
  rulePack: RulePack,
  zone: string,
): Blocker | null {
  const staffId = person.id;
  if (!person.roles.includes(shift.role)) return { staffId, reason: "role", detail: roleDetail(shift.role) };

  const bc = blockingConstraint(staffId, shift, constraints, zone);
  if (bc) return { staffId, reason: "unavailable", detail: bc.detail, constraintId: bc.constraintId, quote: bc.quote };

  const mine = theirShifts
    .filter((t) => t.id !== shift.id)
    .sort((a, b) => ms(a.start) - ms(b.start) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const s0 = ms(shift.start);
  const s1 = ms(shift.end);

  const clash = mine.find((t) => ms(t.start) < s1 && s0 < ms(t.end));
  if (clash) return { staffId, reason: "overlap", detail: `already on ${shiftName(clash)}`, otherShiftId: clash.id };

  const sameDay = mine.filter((t) => t.localDate === shift.localDate);
  if (sameDay.length >= rulePack.maxShiftsPerDay) {
    return sameDay.length === 0
      ? { staffId, reason: "per_day", detail: `no shifts allowed on ${formatDay(shift.localDate)}`, limit: rulePack.maxShiftsPerDay }
      : { staffId, reason: "per_day", detail: `already working ${formatDay(shift.localDate)}`, otherShiftId: sameDay[0].id, limit: rulePack.maxShiftsPerDay };
  }

  const minRestMs = Math.round(rulePack.minRestHours * HOUR_MS);
  let rest: Shift | null = null;
  let restGap = Infinity;
  for (const t of mine) {
    const gap = ms(t.start) <= s0 ? s0 - ms(t.end) : ms(t.start) - s1;
    if (gap < minRestMs && gap < restGap) {
      restGap = gap;
      rest = t;
    }
  }
  if (rest) {
    const hours = Math.round((restGap / HOUR_MS) * 100) / 100;
    const side = ms(rest.start) <= s0 ? "after" : "before";
    return {
      staffId,
      reason: "rest",
      detail: `only ${formatHours(hours)} rest ${side} ${shiftName(rest)}`,
      otherShiftId: rest.id,
      hours,
      limit: rulePack.minRestHours,
    };
  }

  const caps = effectiveCaps(person, constraints, rulePack);
  const used = mine.reduce((sum, t) => sum + centi(t.hours), 0);
  const cap = centi(caps.maxHours);
  if (used + centi(shift.hours) > cap) {
    const hours = used / 100;
    const limit = cap / 100;
    const detail = used >= cap ? `at max ${formatHours(limit)}` : `at ${formatHours(hours)}; this ${formatHours(shift.hours)} shift would pass the ${formatHours(limit)} max`;
    const from = caps.hoursConstraint ? { constraintId: caps.hoursConstraint.id, quote: caps.hoursConstraint.quote } : {};
    return { staffId, reason: "max_hours", detail, ...from, hours, limit };
  }

  if (caps.maxShifts !== null && mine.length + 1 > caps.maxShifts) {
    const limit = caps.maxShifts;
    const from = caps.shiftsConstraint ? { constraintId: caps.shiftsConstraint.id, quote: caps.shiftsConstraint.quote } : {};
    return { staffId, reason: "max_shifts", detail: `at max ${limit} ${limit === 1 ? "shift" : "shifts"}`, ...from, limit };
  }

  return null;
}
