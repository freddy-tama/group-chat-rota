import { describe, expect, it } from "vitest";
import type { Assignment, ResolvedConstraint, Role, Shift, SolveInput, StaffMember } from "@/lib/domain/types";
import { dayWindow, localToInstant, shiftInstants } from "@/lib/domain/time";
import { verifyRota } from "./check";

const ZONE = "Europe/London";

function shift(id: string, localDate: string, startLocal: string, endLocal: string, role: Role = "barista", label = "Shift"): Shift {
  return { id, label, role, localDate, startLocal, endLocal, ...shiftInstants(localDate, startLocal, endLocal, ZONE) };
}

const ALEX: StaffMember = { id: "st_alex", name: "Alex", aliases: ["alex"], roles: ["barista", "keyholder"], maxHours: 40 };
const BEA: StaffMember = { id: "st_bea", name: "Bea", aliases: ["bea"], roles: ["barista"], maxHours: 40 };

function input(shifts: Shift[], constraints: ResolvedConstraint[] = [], staff: StaffMember[] = [ALEX, BEA], minRestHours = 11): SolveInput {
  return {
    timezone: ZONE,
    weekStart: "2026-10-19",
    shifts,
    staff,
    constraints,
    pins: [],
    rulePack: { name: "House rules", version: 3, effectiveFrom: "2026-10-19", minRestHours, maxHoursDefault: 40, maxShiftsPerDay: 1 },
    history: [],
  };
}

const on = (shiftId: string, staffId = "st_alex"): Assignment => ({ shiftId, staffId, pinned: false });
const rules = (vs: { rule: string }[]) => vs.map((v) => v.rule);

describe("verifyRota", () => {
  it("accepts a valid rota", () => {
    const shifts = [shift("a", "2026-10-19", "07:00", "15:00"), shift("b", "2026-10-20", "07:00", "15:00")];
    expect(verifyRota(input(shifts), [on("a"), on("b"), ])).toEqual([]);
  });

  it("flags rest across days: Fri 14:00-22:00 then Sat 07:00-15:00 is 9.0 h, under 11 h", () => {
    const shifts = [shift("fri", "2026-10-23", "14:00", "22:00"), shift("sat", "2026-10-24", "07:00", "15:00")];
    const v = verifyRota(input(shifts), [on("sat"), on("fri")]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: "rest", staffId: "st_alex", shiftIds: ["fri", "sat"] });
    expect(v[0].detail).toContain("9.0 h");
    expect(v[0].detail).toContain("11.0 h");
  });

  it("measures the DST night in real hours: Sat 24 Oct 22:00 -> Sun 25 06:00 is 9 h", () => {
    const night = shift("night", "2026-10-24", "22:00", "06:00", "baker", "Night bake");
    expect(night.hours).toBe(9);
    expect(night.end).toBe("2026-10-25T06:00:00.000Z");
    // A 8 h cap is broken by the 9 h night even though the wall clock says 8 h.
    const capped = { ...ALEX, roles: ["baker" as Role], maxHours: 8 };
    const v = verifyRota(input([night], [], [capped]), [on("night")]);
    expect(v).toMatchObject([{ rule: "max_hours", staffId: "st_alex", shiftIds: ["night"] }]);
    expect(v[0].detail).toContain("9.0 h");
  });

  it("uses real elapsed rest over clock changes", () => {
    // Autumn: Sat 24 Oct close ends 22:00 BST (21:00Z); Sun 08:00 GMT is 11 h later (10 h on the wall clock): OK.
    const autumn = [shift("satClose", "2026-10-24", "14:00", "22:00"), shift("sunOpen", "2026-10-25", "08:00", "16:00")];
    expect(verifyRota(input(autumn), [on("satClose"), on("sunOpen")])).toEqual([]);
    // Spring: Sat 28 Mar close ends 22:00 GMT; Sun 29 Mar 09:00 BST is only 10 h later (11 h on the wall clock).
    const spring = [shift("satClose", "2026-03-28", "14:00", "22:00"), shift("sunOpen", "2026-03-29", "09:00", "17:00")];
    const v = verifyRota(input(spring), [on("satClose"), on("sunOpen")]);
    expect(rules(v)).toEqual(["rest"]);
    expect(v[0].detail).toContain("10.0 h");
  });

  it("flags overlap", () => {
    const shifts = [shift("open", "2026-10-25", "08:00", "16:00"), shift("close", "2026-10-25", "12:00", "18:00")];
    const v = verifyRota(input(shifts), [on("open"), on("close")]);
    expect(rules(v)).toContain("overlap");
    expect(v.find((x) => x.rule === "overlap")).toMatchObject({ staffId: "st_alex", shiftIds: ["close", "open"] });
  });

  it("flags a missing role", () => {
    const v = verifyRota(input([shift("k", "2026-10-22", "11:00", "17:00", "kitchen")]), [on("k")]);
    expect(v).toMatchObject([{ rule: "role", staffId: "st_alex", shiftIds: ["k"] }]);
  });

  it("flags unavailability, honouring only LATER available exceptions", () => {
    const sat = dayWindow("2026-10-24", ZONE);
    const close = shift("close", "2026-10-24", "14:00", "22:00", "keyholder", "Close");
    const off: ResolvedConstraint = { id: "c1", staffId: "st_alex", kind: "unavailable", ...sat, shiftLabel: null, sentAt: "2026-10-14T08:00:00.000Z", quote: "sat off" };
    const v = verifyRota(input([close], [off]), [on("close")]);
    expect(v).toMatchObject([{ rule: "unavailable", staffId: "st_alex", shiftIds: ["close"] }]);
    expect(v[0].detail).toContain('"sat off"');

    const later: ResolvedConstraint = { id: "c2", staffId: "st_alex", kind: "available", ...sat, shiftLabel: "close", sentAt: "2026-10-18T08:00:00.000Z", quote: "can do sat close" };
    expect(verifyRota(input([close], [off, later]), [on("close")])).toEqual([]);

    const earlier = { ...later, sentAt: "2026-10-13T08:00:00.000Z" };
    expect(rules(verifyRota(input([close], [off, earlier]), [on("close")]))).toEqual(["unavailable"]);

    const otherLabel = { ...later, shiftLabel: "Open" };
    expect(rules(verifyRota(input([close], [off, otherLabel]), [on("close")]))).toEqual(["unavailable"]);

    const someoneElse = { ...later, staffId: "st_bea" };
    expect(rules(verifyRota(input([close], [off, someoneElse]), [on("close")]))).toEqual(["unavailable"]);

    // Partial exception: available only from 16:00 leaves 14:00-16:00 blocked.
    const partial = { ...later, shiftLabel: null, start: localToInstant("2026-10-24", "16:00", ZONE) };
    expect(rules(verifyRota(input([close], [off, partial]), [on("close")]))).toEqual(["unavailable"]);
    // Two adjacent exceptions together cover it.
    const morning = { ...partial, id: "c3", start: sat.start, end: localToInstant("2026-10-24", "16:00", ZONE) };
    expect(verifyRota(input([close], [off, partial, morning]), [on("close")])).toEqual([]);
  });

  it("only blocks labelled shifts with a labelled unavailability", () => {
    const sat = dayWindow("2026-10-24", ZONE);
    const open = shift("open", "2026-10-24", "07:00", "15:00", "keyholder", "Open");
    const noClose: ResolvedConstraint = { id: "c1", staffId: "st_alex", kind: "unavailable", ...sat, shiftLabel: "Close", sentAt: "2026-10-14T08:00:00.000Z", quote: "no sat close" };
    expect(verifyRota(input([open], [noClose]), [on("open")])).toEqual([]);
  });

  it("flags the weekly hours cap from the staff record, rule pack and constraints", () => {
    const shifts = ["2026-10-19", "2026-10-20", "2026-10-21"].map((d, i) => shift(`s${i}`, d, "07:00", "15:00"));
    const all = shifts.map((s) => on(s.id));
    expect(verifyRota(input(shifts), all)).toEqual([]);
    const small = { ...ALEX, maxHours: 20 };
    expect(verifyRota(input(shifts, [], [small]), all)).toMatchObject([{ rule: "max_hours", shiftIds: ["s0", "s1", "s2"] }]);
    const cap: ResolvedConstraint = { id: "c1", staffId: "st_alex", kind: "max_hours", value: 16, sentAt: "2026-10-14T08:00:00.000Z", quote: "16 h max" };
    expect(rules(verifyRota(input(shifts, [cap]), all))).toEqual(["max_hours"]);
    const two: ResolvedConstraint = { id: "c2", staffId: "st_alex", kind: "max_shifts", value: 2, sentAt: "2026-10-14T08:00:00.000Z", quote: "max 2 shifts" };
    expect(rules(verifyRota(input(shifts, [two]), all))).toEqual(["max_shifts"]);
  });

  it("flags two shifts on one local day", () => {
    const shifts = [shift("early", "2026-10-21", "00:00", "02:00"), shift("late", "2026-10-21", "20:00", "22:00")];
    expect(rules(verifyRota(input(shifts), [on("early"), on("late")]))).toEqual(["per_day"]);
  });

  it("flags double booking", () => {
    const shifts = [shift("a", "2026-10-19", "07:00", "15:00")];
    expect(verifyRota(input(shifts), [on("a", "st_alex"), on("a", "st_bea")])).toMatchObject([{ rule: "double_booked", staffId: "st_bea", shiftIds: ["a"] }]);
    expect(rules(verifyRota(input(shifts), [on("a"), on("a")]))).toEqual(["double_booked"]);
  });

  it("flags unknown shifts and people", () => {
    const v = verifyRota(input([shift("a", "2026-10-19", "07:00", "15:00")]), [on("nope"), on("a", "st_nobody")]);
    expect(rules(v)).toEqual(["role", "role"]);
  });

  it("does not depend on the order of assignments", () => {
    const shifts = [shift("fri", "2026-10-23", "14:00", "22:00"), shift("sat", "2026-10-24", "07:00", "15:00"), shift("sat2", "2026-10-24", "08:00", "12:00")];
    const a = [on("fri"), on("sat"), on("sat2"), on("sat", "st_bea")];
    expect(verifyRota(input(shifts), [...a].reverse())).toEqual(verifyRota(input(shifts), a));
  });
});
