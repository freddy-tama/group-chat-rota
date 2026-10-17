// Property tests on random small instances in Europe/London (weeks that contain a clock change).
// The brute-force optimum uses only the independent checker (verifyRota) for validity and a
// test-local copy of the objective, so it cross-checks the solver, availability.ts and check.ts.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Assignment, FairnessHistory, Pin, ResolvedConstraint, Role, Shift, SolveInput, SolveResult, StaffMember } from "@/lib/domain/types";
import { addDays, dayWindow, localToInstant, shiftInstants, weekdayOf } from "@/lib/domain/time";
import { verifyRota } from "./check";
import { solve } from "./solve";

const ZONE = "Europe/London";
const WEEKS = ["2026-10-19", "2026-03-23"]; // clocks go back Sun 25 Oct / forward Sun 29 Mar
const ROLES: Role[] = ["keyholder", "barista", "kitchen"];
const LABELS = ["Open", "Close", "Night bake"];
const SENT_BASE = Date.parse("2026-10-10T10:00:00.000Z");

const shiftSpec = fc.record({
  key: fc.integer({ min: 0, max: 99 }),
  day: fc.integer({ min: 3, max: 6 }), // Thu..Sun: a few days, including the clock change
  start: fc.constantFrom(6, 7, 10, 14, 18, 22),
  duration: fc.constantFrom(4, 6, 8),
  role: fc.constantFrom(...ROLES),
  label: fc.constantFrom(...LABELS),
});
const staffSpec = fc.record({
  key: fc.integer({ min: 0, max: 99 }),
  roles: fc.subarray(ROLES, { minLength: 1 }),
  maxHours: fc.constantFrom(6, 8, 12, 16, 24, 40),
  maxShifts: fc.constantFrom(null, null, 1, 2, 3),
  history: fc.tuple(fc.nat(3), fc.nat(3), fc.nat(3)),
});
const constraintSpec = fc.record({
  key: fc.integer({ min: 0, max: 99 }),
  kind: fc.constantFrom("unavailable", "unavailable", "available", "prefer", "prefer_not", "max_hours", "max_shifts"),
  staff: fc.nat(),
  day: fc.integer({ min: 3, max: 6 }),
  shape: fc.constantFrom("day", "from", "until", "span"),
  hour: fc.constantFrom(9, 12, 16),
  label: fc.option(fc.constantFrom(...LABELS), { nil: null }),
  sent: fc.integer({ min: 0, max: 4 }),
  value: fc.integer({ min: 0, max: 3 }),
  // For an unavailability: also add the same person's "available" for the same day, sent this many
  // hours later (<= 0 means earlier or at the same instant, which must NOT lift it).
  exception: fc.option(
    fc.record({
      delay: fc.integer({ min: -1, max: 2 }),
      shape: fc.constantFrom("same", "same", "day", "from", "until"),
      label: fc.constantFrom("same", "same", "none", "other"),
    }),
    { nil: null },
  ),
});
const pinSpec = fc.record({ shift: fc.nat(), staff: fc.nat() });

const pad = (n: number) => String(n).padStart(2, "0");

function buildInstance(
  week: string,
  minRest: number,
  shiftsIn: { key: number; day: number; start: number; duration: number; role: Role; label: string }[],
  staffIn: { key: number; roles: Role[]; maxHours: number; maxShifts: number | null; history: [number, number, number] }[],
  consIn: {
    key: number;
    kind: string;
    staff: number;
    day: number;
    shape: string;
    hour: number;
    label: string | null;
    sent: number;
    value: number;
    exception: { delay: number; shape: string; label: string } | null;
  }[],
  pinsIn: { shift: number; staff: number }[],
): SolveInput {
  const shifts: Shift[] = shiftsIn.map((s, i) => {
    const localDate = addDays(week, s.day);
    const startLocal = `${pad(s.start)}:00`;
    const endLocal = `${pad((s.start + s.duration) % 24)}:00`;
    return { id: `sh_${pad(s.key)}_${i}`, label: s.label, role: s.role, localDate, startLocal, endLocal, ...shiftInstants(localDate, startLocal, endLocal, ZONE) };
  });
  const staff: StaffMember[] = staffIn.map((p, i) => ({
    id: `st_${pad(p.key)}_${i}`,
    name: `Person ${i}`,
    aliases: [],
    roles: p.roles,
    maxHours: p.maxHours,
    maxShifts: p.maxShifts,
  }));
  const history: FairnessHistory[] = staffIn.map((p, i) => ({ staffId: staff[i].id, weeks: 3, closes: p.history[0], weekends: p.history[1], nights: p.history[2] }));
  const windowFor = (date: string, shape: string, hour: number) => {
    const whole = dayWindow(date, ZONE);
    const at = localToInstant(date, `${pad(hour)}:00`, ZONE);
    if (shape === "day") return whole;
    if (shape === "from") return { start: at, end: whole.end };
    if (shape === "until") return { start: whole.start, end: at };
    return { start: at, end: dayWindow(addDays(date, 1), ZONE).end };
  };
  const constraints: ResolvedConstraint[] = consIn.flatMap((c, i): ResolvedConstraint[] => {
    const id = `c_${pad(c.key)}_${i}`;
    const staffId = staff[c.staff % staff.length].id;
    const sentAt = new Date(SENT_BASE + c.sent * 3_600_000).toISOString();
    if (c.kind === "max_hours") return [{ id, staffId, kind: "max_hours", value: [4, 6, 8, 14][c.value], sentAt, quote: id }];
    if (c.kind === "max_shifts") return [{ id, staffId, kind: "max_shifts", value: c.value, sentAt, quote: id }];
    const date = addDays(week, c.day);
    const kind = c.kind as "unavailable" | "available" | "prefer" | "prefer_not";
    const out: ResolvedConstraint[] = [{ id, staffId, kind, ...windowFor(date, c.shape, c.hour), shiftLabel: c.label, sentAt, quote: id }];
    if (kind === "unavailable" && c.exception) {
      const later = new Date(SENT_BASE + (c.sent + c.exception.delay) * 3_600_000).toISOString();
      const window = windowFor(date, c.exception.shape === "same" ? c.shape : c.exception.shape, c.hour);
      const label = c.exception.label === "same" ? c.label : c.exception.label === "none" ? null : LABELS.find((l) => l !== c.label)!;
      out.push({ id: `${id}_x`, staffId, kind: "available", ...window, shiftLabel: label, sentAt: later, quote: `${id}_x` });
    }
    return out;
  });
  const base: SolveInput = {
    timezone: ZONE,
    weekStart: week,
    shifts,
    staff,
    constraints,
    pins: [],
    rulePack: { name: "House rules", version: 1, effectiveFrom: week, minRestHours: minRest, maxHoursDefault: 40, maxShiftsPerDay: 1 },
    history,
  };
  // Consistent pins: keep a pin only if all pins so far still pass the independent checker.
  const pins: Pin[] = [];
  for (const p of pinsIn) {
    const shiftId = shifts[p.shift % shifts.length].id;
    const staffId = staff[p.staff % staff.length].id;
    if (pins.some((x) => x.shiftId === shiftId)) continue;
    const next = [...pins, { shiftId, staffId, reason: "test" }];
    if (verifyRota(base, next.map((x) => ({ shiftId: x.shiftId, staffId: x.staffId, pinned: true }))).length === 0) pins.push(next[next.length - 1]);
  }
  return { ...base, pins };
}

const instance = (maxShifts: number, maxStaff: number) =>
  fc
    .tuple(
      fc.constantFrom(...WEEKS),
      fc.constantFrom(8, 11, 12),
      fc.array(shiftSpec, { minLength: 2, maxLength: maxShifts }),
      fc.array(staffSpec, { minLength: 2, maxLength: maxStaff }),
      fc.array(constraintSpec, { maxLength: 6 }),
      fc.array(pinSpec, { maxLength: 3 }),
    )
    .map(([week, rest, s, p, c, pins]) => buildInstance(week, rest, s, p, c, pins));

// ---- test-local objective (independent of solve.ts) -------------------------------------------

function prefOf(input: SolveInput, rota: Assignment[]): number {
  let score = 0;
  for (const a of rota) {
    const shift = input.shifts.find((s) => s.id === a.shiftId)!;
    for (const c of input.constraints) {
      if (c.staffId !== a.staffId || (c.kind !== "prefer" && c.kind !== "prefer_not")) continue;
      const labelOk = c.shiftLabel == null || c.shiftLabel.toLowerCase() === shift.label.toLowerCase();
      const t = Date.parse(shift.start);
      if (labelOk && Date.parse(c.start) <= t && t < Date.parse(c.end)) score += c.kind === "prefer" ? 1 : -1;
    }
  }
  return score;
}

function fairnessOf(input: SolveInput, rota: Assignment[]): number {
  const inCat = [
    (s: Shift) => s.label.toLowerCase() === "close",
    (s: Shift) => weekdayOf(s.localDate) === "sat" || weekdayOf(s.localDate) === "sun",
    (s: Shift) => /night/i.test(s.label) || (s.endLocal < s.startLocal && s.endLocal !== "00:00"),
  ];
  let total = 0;
  inCat.forEach((isCat, c) => {
    const pool = input.staff.filter((p) => input.shifts.some((s) => isCat(s) && p.roles.includes(s.role)));
    if (pool.length === 0) return;
    const loads = pool.map((p) => {
      const h = input.history.find((x) => x.staffId === p.id);
      const past = h ? [h.closes, h.weekends, h.nights][c] : 0;
      return past + rota.filter((a) => a.staffId === p.id && isCat(input.shifts.find((s) => s.id === a.shiftId)!)).length;
    });
    const mean = loads.reduce((x, y) => x + y, 0) / loads.length;
    total += loads.reduce((acc, x) => acc + (x - mean) ** 2, 0);
  });
  return total;
}

/** Exhaustive optimum under the documented objective, using verifyRota for validity. */
function bruteForce(input: SolveInput): Assignment[] {
  const shifts = [...input.shifts].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.id < b.id ? -1 : 1));
  const staffIds = input.staff.map((p) => p.id).sort();
  const pinned = new Map(input.pins.map((p) => [p.shiftId, p.staffId]));
  let best: { rota: Assignment[]; cov: number; pref: number; fair: number; vec: number[] } | null = null;
  const rota: Assignment[] = input.pins.map((p) => ({ shiftId: p.shiftId, staffId: p.staffId, pinned: true }));
  const vec: number[] = [];

  const visit = (i: number) => {
    if (i === shifts.length) {
      const cov = rota.length;
      const pref = prefOf(input, rota);
      const fair = fairnessOf(input, rota);
      const better =
        !best ||
        cov > best.cov ||
        (cov === best.cov && pref > best.pref) ||
        (cov === best.cov && pref === best.pref && fair < best.fair - 1e-9) ||
        (cov === best.cov && pref === best.pref && Math.abs(fair - best.fair) <= 1e-9 && lexLess(vec, best.vec));
      if (better) best = { rota: [...rota], cov, pref, fair, vec: [...vec] };
      return;
    }
    const s = shifts[i];
    const pin = pinned.get(s.id);
    if (pin !== undefined) {
      vec.push(staffIds.indexOf(pin));
      visit(i + 1);
      vec.pop();
      return;
    }
    for (let p = 0; p <= staffIds.length; p++) {
      if (p < staffIds.length) {
        rota.push({ shiftId: s.id, staffId: staffIds[p], pinned: false });
        if (verifyRota(input, rota).length === 0) {
          vec.push(p);
          visit(i + 1);
          vec.pop();
        }
        rota.pop();
      } else {
        vec.push(staffIds.length); // uncovered sorts after every person
        visit(i + 1);
        vec.pop();
      }
    }
  };
  visit(0);
  return best!.rota;
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

const pairs = (rota: Assignment[]) => rota.map((a) => `${a.shiftId}>${a.staffId}>${a.pinned}`).sort();

function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let x = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const FIRST_RULE: string[] = ["unavailable", "overlap", "per_day", "rest", "max_hours", "max_shifts"];

function assertSound(input: SolveInput, r: SolveResult) {
  expect(r.violations).toEqual([]);
  expect(verifyRota(input, r.assignments)).toEqual([]);
  // pins kept
  for (const pin of input.pins) expect(r.assignments).toContainEqual({ shiftId: pin.shiftId, staffId: pin.staffId, pinned: true });
  expect(r.assignments.filter((a) => a.pinned)).toHaveLength(input.pins.length);
  // each shift at most once, coverage consistent
  expect(new Set(r.assignments.map((a) => a.shiftId)).size).toBe(r.assignments.length);
  expect(r.coverage).toEqual({ covered: r.assignments.length, total: input.shifts.length });
  expect(r.uncovered.length).toBe(input.shifts.length - r.assignments.length);
  // every blocker is real: handing the shift to that person breaks exactly that first rule
  for (const u of r.uncovered) {
    const shift = input.shifts.find((s) => s.id === u.shiftId)!;
    expect(u.blockers.length + u.withoutRole).toBe(input.staff.length);
    expect(u.withoutRole).toBe(input.staff.filter((p) => !p.roles.includes(shift.role)).length);
    for (const b of u.blockers) {
      const broken = new Set<string>(verifyRota(input, [...r.assignments, { shiftId: u.shiftId, staffId: b.staffId, pinned: false }]).filter((v) => v.staffId === b.staffId).map((v) => v.rule));
      expect(FIRST_RULE.find((rule) => broken.has(rule))).toBe(b.reason);
    }
  }
}

describe("solver properties", () => {
  it("the generators produce the interesting cases (gaps, pins, exceptions, clock changes)", () => {
    const sample = fc.sample(instance(8, 4), { numRuns: 400, seed: 1 });
    const results = sample.map((x) => solve(x));
    const share = (f: (i: number) => boolean) => sample.filter((_, i) => f(i)).length / sample.length;
    expect(share((i) => results[i].uncovered.length > 0)).toBeGreaterThan(0.3);
    expect(share((i) => results[i].coverage.covered > 0)).toBeGreaterThan(0.5);
    expect(share((i) => sample[i].pins.length > 0)).toBeGreaterThan(0.3);
    expect(share((i) => sample[i].shifts.some((s) => s.hours % 1 === 0 && ![4, 6, 8].includes(s.hours)))).toBeGreaterThan(0.05); // DST-length shifts
    const reasons = new Set(results.flatMap((r) => r.uncovered.flatMap((u) => u.blockers.map((b) => b.reason))));
    expect([...reasons].sort()).toEqual(["max_hours", "max_shifts", "overlap", "per_day", "rest", "unavailable"]);
    // some "available" constraints actually change the answer
    const lifted = sample.filter((x) => {
      const withoutAvail = { ...x, constraints: x.constraints.filter((c) => c.kind !== "available") };
      const pinsOk = verifyRota(withoutAvail, withoutAvail.pins.map((p) => ({ ...p, pinned: true }))).length === 0;
      return pinsOk && solve(withoutAvail).coverage.covered < solve(x).coverage.covered;
    });
    expect(lifted.length).toBeGreaterThan(0);
  });

  it("solver output always passes the independent checker, keeps pins and explains every gap", () => {
    fc.assert(
      fc.property(instance(8, 4), (input) => {
        assertSound(input, solve(input));
      }),
      { numRuns: 1000, seed: 20261019 },
    );
  });

  it("matches the brute-force optimum on tiny instances (coverage, preference, fairness and tie-break)", () => {
    fc.assert(
      fc.property(instance(6, 3), (input) => {
        const r = solve(input);
        expect(r.search.complete).toBe(true);
        const best = bruteForce(input);
        expect(r.coverage.covered).toBe(best.length);
        expect(r.objective.preferenceScore).toBe(prefOf(input, best));
        expect(r.objective.fairnessPenalty).toBeCloseTo(fairnessOf(input, best), 2); // reported to 3 decimals
        expect(pairs(r.assignments)).toEqual(pairs(best));
      }),
      { numRuns: 1000, seed: 424242 },
    );
  });

  it("adding a staff member never reduces coverage", () => {
    fc.assert(
      fc.property(instance(8, 4), staffSpec, (input, extra) => {
        const person: StaffMember = { id: `st_${pad(extra.key)}_new`, name: "New", aliases: [], roles: extra.roles, maxHours: extra.maxHours, maxShifts: extra.maxShifts };
        const before = solve(input);
        const after = solve({ ...input, staff: [...input.staff, person] });
        expect(before.search.complete && after.search.complete).toBe(true);
        expect(after.coverage.covered).toBeGreaterThanOrEqual(before.coverage.covered);
      }),
      { numRuns: 500, seed: 7 },
    );
  });

  it("removing a constraint never reduces coverage (removing an 'available' never increases it)", () => {
    fc.assert(
      fc.property(instance(8, 4), fc.nat(), (input, which) => {
        fc.pre(input.constraints.length > 0);
        const removed = input.constraints[which % input.constraints.length];
        // a pin may rely on the removed "available"; keep the instance consistent
        const rest = { ...input, constraints: input.constraints.filter((c) => c !== removed) };
        fc.pre(verifyRota(rest, rest.pins.map((p) => ({ shiftId: p.shiftId, staffId: p.staffId, pinned: true }))).length === 0);
        const before = solve(input).coverage.covered;
        const after = solve(rest).coverage.covered;
        if (removed.kind === "available") expect(after).toBeLessThanOrEqual(before);
        else expect(after).toBeGreaterThanOrEqual(before);
      }),
      { numRuns: 500, seed: 99 },
    );
  });

  it("is independent of input order (byte-identical JSON)", () => {
    fc.assert(
      fc.property(instance(8, 4), fc.integer({ min: 1, max: 2 ** 31 - 1 }), (input, seed) => {
        const shuffled: SolveInput = {
          ...input,
          shifts: shuffle(input.shifts, seed),
          staff: shuffle(input.staff, seed + 1).map((p) => ({ ...p, roles: shuffle(p.roles, seed + 2) })),
          constraints: shuffle(input.constraints, seed + 3),
          pins: shuffle(input.pins, seed + 4),
          history: shuffle(input.history, seed + 5),
        };
        expect(JSON.stringify(solve(shuffled))).toBe(JSON.stringify(solve(input)));
      }),
      { numRuns: 500, seed: 31337 },
    );
  });
});
