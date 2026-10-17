import { describe, expect, it } from "vitest";
import { buildCornerCafeInput, CORNER_CAFE } from "@/lib/demo/corner-cafe";
import type { ResolvedConstraint, SolveInput } from "@/lib/domain/types";
import { dayWindow } from "@/lib/domain/time";
import { verifyRota } from "./check";
import { solve } from "./solve";

const SAT = dayWindow("2026-10-24", "Europe/London");

/** J2: Ana pastes "actually I can do sat close now" and Lou confirms it. */
const ANA_SAT_CLOSE: ResolvedConstraint = {
  id: "c_22",
  staffId: "st_ana",
  kind: "available",
  start: SAT.start,
  end: SAT.end,
  shiftLabel: "Close",
  sentAt: "2026-10-18T20:30:00.000Z",
  quote: "actually I can do sat close now",
};

const staffOn = (r: ReturnType<typeof solve>, shiftId: string) => r.assignments.filter((a) => a.shiftId === shiftId).map((a) => a.staffId);

/** Deterministic Fisher-Yates with a small LCG, so "shuffled" inputs are reproducible. */
function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let x = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function shuffleInput(input: SolveInput, seed: number): SolveInput {
  return {
    ...input,
    shifts: shuffled(input.shifts, seed),
    staff: shuffled(input.staff, seed + 1).map((s) => ({ ...s, roles: shuffled(s.roles, seed + 2) })),
    constraints: shuffled(input.constraints, seed + 3),
    pins: shuffled(input.pins, seed + 4),
    history: shuffled(input.history, seed + 5),
  };
}

// The very first solve in this file (cold JIT) is timed too.
const coldStart = performance.now();
const COLD_RESULT = solve(buildCornerCafeInput());
const COLD_MS = performance.now() - coldStart;

describe("Corner Café: the structural facts of DOMAIN.md", () => {
  const result = COLD_RESULT;

  it("covers 21 of 22 shifts with a complete search; only Sat 24 Oct Close (sh_18) is uncovered", () => {
    expect(result.coverage).toEqual({ covered: 21, total: 22 });
    expect(result.objective.covered).toBe(21);
    expect(result.search.complete).toBe(true);
    expect(result.uncovered.map((u) => u.shiftId)).toEqual(["sh_18"]);
    expect(staffOn(result, "sh_18")).toEqual([]);
  });

  it("explains sh_18: every key holder is blocked, the other 5 staff lack the role", () => {
    const [u] = result.uncovered;
    expect(u.role).toBe("keyholder");
    expect(u.withoutRole).toBe(5);
    expect(u.blockers.map((b) => [b.staffId, b.reason])).toEqual([
      ["st_ana", "unavailable"],
      ["st_ben", "max_hours"],
      ["st_dara", "unavailable"],
      ["st_sam", "unavailable"],
    ]);
    const by = Object.fromEntries(u.blockers.map((b) => [b.staffId, b]));
    expect(by.st_ana).toMatchObject({ quote: "sat off pls", constraintId: "c_01", detail: "unavailable all day Sat 24 Oct" });
    expect(by.st_ben).toMatchObject({ hours: 40, limit: 40, detail: "at max 40.0 h" });
    expect(by.st_dara).toMatchObject({ quote: "no sat close for me sorry", constraintId: "c_04", detail: "unavailable for Close on Sat 24 Oct" });
    expect(by.st_sam).toMatchObject({ quote: "need sat off", constraintId: "c_03", detail: "unavailable all day Sat 24 Oct" });
  });

  it("gives Sat 24 Oct Open (sh_15) to Dara", () => {
    expect(staffOn(result, "sh_15")).toEqual(["st_dara"]);
  });

  it("puts Priya on all three night bakes: 8 + 8 + 9 = 25.0 h", () => {
    expect(CORNER_CAFE.shifts.find((s) => s.id === "sh_19")!.hours).toBe(9);
    for (const id of ["sh_07", "sh_14", "sh_19"]) expect(staffOn(result, id)).toEqual(["st_priya"]);
    expect(result.assignments.filter((a) => a.staffId === "st_priya").map((a) => a.shiftId)).toEqual(["sh_07", "sh_14", "sh_19"]);
    expect(result.totals.find((t) => t.staffId === "st_priya")).toMatchObject({ hours: 25, shifts: 3 });
  });

  it("keeps Ben pinned on the five weekday closes (40.0 h, his cap)", () => {
    const ben = result.assignments.filter((a) => a.staffId === "st_ben");
    expect(ben).toEqual(["sh_02", "sh_04", "sh_06", "sh_10", "sh_13"].map((shiftId) => ({ shiftId, staffId: "st_ben", pinned: true })));
    expect(result.assignments.filter((a) => a.pinned)).toHaveLength(5);
    expect(result.totals.find((t) => t.staffId === "st_ben")).toMatchObject({ hours: 40, shifts: 5 });
  });

  it("has no violations, and nobody rests under 11 h", () => {
    expect(result.violations).toEqual([]);
    expect(verifyRota(buildCornerCafeInput(), result.assignments)).toEqual([]);
    for (const t of result.totals) if (t.minRestHours !== null) expect(t.minRestHours).toBeGreaterThanOrEqual(11);
  });

  it("returns totals for all 9 staff sorted by id, adding up to the assigned hours", () => {
    expect(result.totals.map((t) => t.staffId)).toEqual([...CORNER_CAFE.staff.map((s) => s.id)].sort());
    const hours = result.assignments.reduce((sum, a) => sum + CORNER_CAFE.shifts.find((s) => s.id === a.shiftId)!.hours, 0);
    expect(result.totals.reduce((sum, t) => sum + t.hours, 0)).toBe(hours);
    expect(result.totals.reduce((sum, t) => sum + t.shifts, 0)).toBe(21);
  });

  it("honours the soft preferences once coverage is maximal", () => {
    expect(staffOn(result, "sh_17")).toEqual(["st_kofi"]); // "sat mid fine" + morning start
    expect(staffOn(result, "sh_09")).toEqual(["st_mei"]);
    expect(staffOn(result, "sh_12")).toEqual(["st_mei"]);
    expect(staffOn(result, "sh_16")).toEqual(["st_tom"]);
    expect(staffOn(result, "sh_21")).toEqual(["st_tom"]);
    expect(result.objective.preferenceScore).toBe(6);
  });
});

describe("Corner Café: available exceptions", () => {
  it("J2: Ana's later 'available' for Sat Close gives 22/22 with Ana on sh_18", () => {
    const r = solve(buildCornerCafeInput([ANA_SAT_CLOSE]));
    expect(r.coverage).toEqual({ covered: 22, total: 22 });
    expect(staffOn(r, "sh_18")).toEqual(["st_ana"]);
    expect(r.uncovered).toEqual([]);
    expect(r.violations).toEqual([]);
    expect(staffOn(r, "sh_15")).toEqual(["st_dara"]); // the exception is Close only; Ana is still off for Sat Open
  });

  it("an 'available' sent BEFORE the unavailability does not override it", () => {
    const early = { ...ANA_SAT_CLOSE, sentAt: "2026-10-13T20:30:00.000Z" };
    const r = solve(buildCornerCafeInput([early]));
    expect(r.coverage).toEqual({ covered: 21, total: 22 });
    expect(r.uncovered.map((u) => u.shiftId)).toEqual(["sh_18"]);
    expect(r.uncovered[0].blockers.find((b) => b.staffId === "st_ana")).toMatchObject({ reason: "unavailable", constraintId: "c_01" });
  });

  it("someone else's 'available' does not lift Ana's unavailability", () => {
    const r = solve(buildCornerCafeInput([{ ...ANA_SAT_CLOSE, staffId: "st_dara", id: "c_23" }]));
    // Dara's own Close-only unavailability is lifted instead, so she can take sh_18 ... but she is on
    // sh_15 that day (the only key holder free that morning), so coverage stays 21.
    expect(r.coverage.covered).toBe(21);
    expect(r.violations).toEqual([]);
  });
});

describe("Determinism", () => {
  it("20 runs give byte-identical JSON", () => {
    const first = JSON.stringify(solve(buildCornerCafeInput()));
    for (let i = 0; i < 19; i++) expect(JSON.stringify(solve(buildCornerCafeInput()))).toBe(first);
  });

  it("shuffled input arrays give identical output", () => {
    const base = JSON.stringify(solve(buildCornerCafeInput()));
    const j2 = JSON.stringify(solve(buildCornerCafeInput([ANA_SAT_CLOSE])));
    for (let seed = 1; seed <= 10; seed++) {
      expect(JSON.stringify(solve(shuffleInput(buildCornerCafeInput(), seed * 7919)))).toBe(base);
      expect(JSON.stringify(solve(shuffleInput(buildCornerCafeInput([ANA_SAT_CLOSE]), seed * 104729)))).toBe(j2);
    }
  });

  it("solves Corner Café in well under 1 s", () => {
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) solve(buildCornerCafeInput());
    const warm = (performance.now() - t1) / 10;
    console.log(`Corner Café solve: ${COLD_MS.toFixed(1)} ms cold (first call), ${warm.toFixed(1)} ms average warm, ${COLD_RESULT.search.nodes} nodes`);
    expect(COLD_MS).toBeLessThan(1000);
    expect(warm).toBeLessThan(100);
  });

  it("a tiny node budget still returns a valid rota with real blockers (search.complete = false)", () => {
    const r = solve(buildCornerCafeInput(), { coverageNodeBudget: 3, refineNodeBudget: 3 });
    expect(r.search.complete).toBe(false);
    expect(r.violations).toEqual([]);
    for (const u of r.uncovered) expect(u.blockers.length + u.withoutRole).toBe(9);
    const again = solve(buildCornerCafeInput(), { coverageNodeBudget: 3, refineNodeBudget: 3 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(r));
  });
});

describe("Pins and blockers beyond the demo", () => {
  it("keeps a pin that breaks a rule and lets the checker report it", () => {
    const input = buildCornerCafeInput();
    input.pins.push({ shiftId: "sh_18", staffId: "st_ana", reason: "manager override" });
    const r = solve(input);
    expect(staffOn(r, "sh_18")).toEqual(["st_ana"]);
    expect(r.assignments.find((a) => a.shiftId === "sh_18")!.pinned).toBe(true);
    expect(r.violations.map((v) => [v.rule, v.staffId, v.shiftIds])).toEqual([["unavailable", "st_ana", ["sh_18"]]]);
  });

  const LATE: ResolvedConstraint["sentAt"] = "2026-10-18T21:00:00.000Z";
  const SUN = dayWindow("2026-10-25", "Europe/London");

  it("reports an overlap blocker", () => {
    // Sam pinned on Sun Open; Ana and Dara off all Sunday: Sun Close (12:00-18:00) overlaps Sam's Open.
    const input = buildCornerCafeInput();
    input.pins.push({ shiftId: "sh_20", staffId: "st_sam", reason: "test" });
    input.constraints.push({ id: "c_90", staffId: "st_ana", kind: "unavailable", ...SUN, shiftLabel: null, sentAt: LATE, quote: "off sun" });
    input.constraints.push({ id: "c_91", staffId: "st_dara", kind: "unavailable", ...SUN, shiftLabel: null, sentAt: LATE, quote: "off sun" });
    const r = solve(input);
    expect(r.violations).toEqual([]);
    const close = r.uncovered.find((u) => u.shiftId === "sh_22")!;
    expect(close.blockers.find((b) => b.staffId === "st_sam")).toMatchObject({ reason: "overlap", detail: "already on Sun 25 Oct Open", otherShiftId: "sh_20" });
    // Ana has two blocking constraints; the first by id is reported.
    expect(close.blockers.find((b) => b.staffId === "st_ana")).toMatchObject({ reason: "unavailable", constraintId: "c_21", quote: "can't do sun close" });
  });

  it("reports cap blockers with the constraint that set the cap", () => {
    const input = buildCornerCafeInput();
    input.constraints.push({ id: "c_92", staffId: "st_jo", kind: "max_shifts", value: 0, sentAt: LATE, quote: "none for me" });
    input.constraints.push({ id: "c_93", staffId: "st_kofi", kind: "max_hours", value: 6, sentAt: LATE, quote: "6 h max" });
    input.constraints.push({ id: "c_94", staffId: "st_mei", kind: "unavailable", ...SAT, shiftLabel: "Mid", sentAt: LATE, quote: "no sat mid" });
    const r = solve(input);
    expect(r.violations).toEqual([]);
    const mid = r.uncovered.find((u) => u.shiftId === "sh_17")!;
    expect(mid.withoutRole).toBe(2); // Priya, Tom
    const by = Object.fromEntries(mid.blockers.map((b) => [b.staffId, b]));
    expect(Object.keys(by).sort()).toEqual(["st_ana", "st_ben", "st_dara", "st_jo", "st_kofi", "st_mei", "st_sam"]);
    expect(by.st_jo).toMatchObject({ reason: "max_shifts", detail: "at max 0 shifts", constraintId: "c_92", quote: "none for me", limit: 0 });
    expect(by.st_kofi).toMatchObject({ reason: "max_hours", constraintId: "c_93", hours: 0, limit: 6, detail: "at 0.0 h; this 8.0 h shift would pass the 6.0 h max" });
    expect(by.st_dara).toMatchObject({ reason: "overlap", otherShiftId: "sh_15", detail: "already on Sat 24 Oct Open" });
    expect(by.st_mei).toMatchObject({ reason: "unavailable", constraintId: "c_94", detail: "unavailable for Mid on Sat 24 Oct" });
  });

  it("reports a per-day blocker", () => {
    // An extra Sat 19:00-23:00 barista shift: Dara (Sat Open) and Kofi (Sat Mid) are already working that day.
    const input = buildCornerCafeInput();
    input.shifts.push({ id: "sh_23", label: "Late", role: "barista", localDate: "2026-10-24", startLocal: "19:00", endLocal: "23:00", start: "2026-10-24T18:00:00.000Z", end: "2026-10-24T22:00:00.000Z", hours: 4 });
    input.constraints.push({ id: "c_92", staffId: "st_jo", kind: "max_shifts", value: 0, sentAt: LATE, quote: "none for me" });
    input.constraints.push({ id: "c_94", staffId: "st_mei", kind: "unavailable", ...SAT, shiftLabel: null, sentAt: LATE, quote: "off sat" });
    const r = solve(input);
    expect(r.violations).toEqual([]);
    expect(staffOn(r, "sh_17")).toEqual(["st_kofi"]); // his preference decides which of Mid/Late he takes
    const late = r.uncovered.find((u) => u.shiftId === "sh_23")!;
    const by = Object.fromEntries(late.blockers.map((b) => [b.staffId, b]));
    expect(by.st_dara).toMatchObject({ reason: "per_day", detail: "already working Sat 24 Oct", otherShiftId: "sh_15" });
    expect(by.st_kofi).toMatchObject({ reason: "per_day", detail: "already working Sat 24 Oct", otherShiftId: "sh_17" });
  });

  it("reports a rest blocker with the real gap across the clock change", () => {
    // Sun Open (08:00 GMT) after a pinned Sat Close (22:00 BST = 21:00Z) is exactly 11 h: allowed.
    // With a 12 h rule pack it is a rest blocker of 11.0 h.
    const input = buildCornerCafeInput([ANA_SAT_CLOSE]);
    input.rulePack = { ...input.rulePack, minRestHours: 12 };
    input.pins.push({ shiftId: "sh_18", staffId: "st_ana", reason: "test" });
    for (const [id, staffId] of [["c_90", "st_dara"], ["c_91", "st_sam"]] as const) {
      input.constraints.push({ id, staffId, kind: "unavailable", ...dayWindow("2026-10-25", "Europe/London"), shiftLabel: "Open", sentAt: "2026-10-18T21:00:00.000Z", quote: "no sun open" });
    }
    const r = solve(input);
    expect(r.violations).toEqual([]);
    const open = r.uncovered.find((u) => u.shiftId === "sh_20")!;
    expect(open.blockers.find((b) => b.staffId === "st_ana")).toMatchObject({
      reason: "rest",
      hours: 11,
      limit: 12,
      otherShiftId: "sh_18",
      detail: "only 11.0 h rest after Sat 24 Oct Close",
    });
  });
});
