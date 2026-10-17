// Shared domain types. The solver, the checker, the chat pipeline and the API all speak these.
// Instants are ISO-8601 strings in UTC ("2026-10-24T21:00:00.000Z"). Local dates are "YYYY-MM-DD"
// in the workspace time zone; local times are "HH:MM" (24 h).

export type Role = "keyholder" | "barista" | "kitchen" | "baker";

export interface StaffMember {
  id: string;
  name: string;
  aliases: string[]; // lower-case names people use in the chat ("sam", "sammy")
  roles: Role[];
  maxHours: number; // weekly cap from the staff record (the rule pack may lower it, never raise it)
  maxShifts?: number | null; // weekly cap on number of shifts, if any
  hourlyRate?: number | null;
}

export interface Shift {
  id: string;
  label: string; // "Open", "Close", "Mid", "Kitchen", "Brunch", "Night bake"
  role: Role; // the one role this shift needs
  localDate: string; // date the shift starts on, workspace zone
  startLocal: string; // "HH:MM"
  endLocal: string; // "HH:MM"; earlier than or equal to startLocal means it ends the next day
  start: string; // UTC instant
  end: string; // UTC instant
  hours: number; // real elapsed hours between start and end (DST-aware)
}

/** A confirmed constraint after code has resolved it to concrete instants. */
export type ResolvedConstraint =
  | {
      id: string;
      staffId: string;
      kind: "unavailable" | "available";
      // The window in UTC instants. "available" carves an exception out of earlier unavailability.
      start: string;
      end: string;
      // Optional: only applies to shifts with this label inside the window (e.g. "Close").
      shiftLabel?: string | null;
      sentAt: string; // when the source message was sent (later messages win)
      quote: string;
    }
  | {
      id: string;
      staffId: string;
      kind: "prefer" | "prefer_not";
      start: string;
      end: string;
      shiftLabel?: string | null;
      sentAt: string;
      quote: string;
    }
  | {
      id: string;
      staffId: string;
      kind: "max_shifts" | "max_hours";
      value: number;
      sentAt: string;
      quote: string;
    };

export interface Pin {
  shiftId: string;
  staffId: string;
  reason: string; // "Contract: weekday closes"
}

export interface RulePack {
  name: string; // "House rules"
  version: number; // 3
  effectiveFrom: string; // local date
  minRestHours: number; // 11
  maxHoursDefault: number; // 40
  maxShiftsPerDay: number; // 1
}

/** Counts of less-wanted shifts each person worked in recent weeks; feeds the fairness tie-break. */
export interface FairnessHistory {
  staffId: string;
  weeks: number;
  closes: number;
  weekends: number;
  nights: number;
}

export interface SolveInput {
  timezone: string; // "Europe/London"
  weekStart: string; // local date of the Monday
  shifts: Shift[];
  staff: StaffMember[];
  constraints: ResolvedConstraint[];
  pins: Pin[];
  rulePack: RulePack;
  history: FairnessHistory[];
}

export type BlockReason =
  | "role" // lacks the role the shift needs
  | "unavailable" // a confirmed constraint covers the shift
  | "overlap" // already on an overlapping shift
  | "rest" // the gap to another of their shifts would be under the rule pack's minimum
  | "max_hours" // taking it would exceed their weekly hours cap
  | "max_shifts" // taking it would exceed their weekly shift cap
  | "per_day"; // already has the maximum shifts that day

export interface Blocker {
  staffId: string;
  reason: BlockReason;
  detail: string; // human sentence, e.g. "unavailable all day Sat 24 Oct"
  constraintId?: string;
  quote?: string;
  otherShiftId?: string; // for overlap/rest
  hours?: number; // current weekly hours (max_hours) or the rest gap in hours (rest)
  limit?: number;
}

export interface Assignment {
  shiftId: string;
  staffId: string;
  pinned: boolean;
}

export interface Uncovered {
  shiftId: string;
  role: Role;
  blockers: Blocker[]; // one per staff member who has the role; people without it are summarised
  withoutRole: number;
}

export interface Violation {
  rule: "role" | "unavailable" | "overlap" | "rest" | "max_hours" | "max_shifts" | "per_day" | "double_booked";
  staffId: string;
  shiftIds: string[];
  detail: string;
}

export interface StaffTotals {
  staffId: string;
  hours: number;
  shifts: number;
  minRestHours: number | null; // smallest gap between two of their shifts this week
}

export interface SolveResult {
  assignments: Assignment[];
  uncovered: Uncovered[];
  coverage: { covered: number; total: number };
  totals: StaffTotals[];
  violations: Violation[]; // from the independent checker; must always be empty for solver output
  objective: { covered: number; preferenceScore: number; fairnessPenalty: number };
  search: { nodes: number; complete: boolean };
}
