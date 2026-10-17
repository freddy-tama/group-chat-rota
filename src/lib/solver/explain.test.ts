import { describe, expect, it } from "vitest";
import { buildCornerCafeInput } from "@/lib/demo/corner-cafe";
import { explainShift } from "./explain";
import { solve } from "./solve";

const input = buildCornerCafeInput();
const result = solve(input);
const cand = (e: ReturnType<typeof explainShift>, staffId: string) => e.candidates.find((c) => c.staffId === staffId)!;

describe("explainShift (Corner Café)", () => {
  it("sh_15 Sat Open: Dara, and why nobody else could take it", () => {
    const e = explainShift(input, result, "sh_15");
    expect(e).toMatchObject({ shiftId: "sh_15", role: "keyholder", hours: 8 });
    expect(e.assignee).toMatchObject({ staffId: "st_dara", pinned: false, cap: 40 });
    expect(e.assignee!.pinReason).toBeUndefined();
    expect(e.candidates.map((c) => c.staffId)).toEqual(["st_ana", "st_ben", "st_dara", "st_jo", "st_kofi", "st_mei", "st_priya", "st_sam", "st_tom"]);
    expect(cand(e, "st_dara")).toMatchObject({ status: "assigned", detail: "on this shift" });
    expect(cand(e, "st_ana")).toMatchObject({ status: "blocked", reason: "unavailable", quote: "sat off pls", constraintId: "c_01", detail: "unavailable all day Sat 24 Oct" });
    expect(cand(e, "st_sam")).toMatchObject({ status: "blocked", reason: "unavailable", quote: "need sat off", detail: "unavailable all day Sat 24 Oct" });
    // Ben is also at his 40 h cap, but the first failing rule in the order (unavailable, overlap,
    // per_day, rest, max_hours, max_shifts) is rest: his pinned Fri Close ends 22:00, Sat Open starts 07:00.
    expect(cand(e, "st_ben")).toMatchObject({ status: "blocked", reason: "rest", detail: "only 9.0 h rest after Fri 23 Oct Close" });
    for (const id of ["st_jo", "st_kofi", "st_mei", "st_priya", "st_tom"]) {
      expect(cand(e, id)).toMatchObject({ status: "blocked", reason: "role", detail: "not a key holder" });
    }
    // Dara's week: Sat Open is her only Saturday shift; her rest around it is real elapsed time.
    const dara = result.assignments.filter((a) => a.staffId === "st_dara").map((a) => a.shiftId);
    expect(e.assignee!.weekHours).toBe(dara.length * 8 - (dara.includes("sh_22") ? 2 : 0));
    if (e.assignee!.restBefore) expect(e.assignee!.restBefore.hours).toBeGreaterThanOrEqual(11);
    if (e.assignee!.restAfter) expect(e.assignee!.restAfter.hours).toBeGreaterThanOrEqual(11);
  });

  it("Ben is blocked by his 40 h cap where rest is fine (Sun Open)", () => {
    const e = explainShift(input, result, "sh_20");
    expect(cand(e, "st_ben")).toMatchObject({ status: "blocked", reason: "max_hours", detail: "at max 40.0 h" });
  });

  it("sh_19 Sat night bake: Priya, 9 h, with real rest before it", () => {
    const e = explainShift(input, result, "sh_19");
    expect(e.hours).toBe(9);
    expect(e.assignee).toMatchObject({ staffId: "st_priya", pinned: false, weekHours: 25, cap: 30, restBefore: { hours: 16, otherShiftId: "sh_14" }, restAfter: null });
    expect(cand(e, "st_tom")).toMatchObject({ status: "blocked", reason: "role", detail: "not a baker" });
  });

  it("sh_04 Tue Close: Ben pinned, Sam off after 4", () => {
    const e = explainShift(input, result, "sh_04");
    expect(e.assignee).toMatchObject({ staffId: "st_ben", pinned: true, pinReason: "Contract: weekday closes", weekHours: 40, cap: 40 });
    expect(e.assignee!.restBefore).toEqual({ hours: 16, otherShiftId: "sh_02" });
    expect(e.assignee!.restAfter).toEqual({ hours: 16, otherShiftId: "sh_06" });
    expect(cand(e, "st_ben")).toMatchObject({ status: "assigned", detail: "pinned: Contract: weekday closes" });
    expect(cand(e, "st_sam")).toMatchObject({ status: "blocked", reason: "unavailable", quote: "can't do tues after 4", detail: "unavailable from 16:00 on Tue 20 Oct" });
    expect(cand(e, "st_kofi")).toMatchObject({ status: "blocked", reason: "role" });
  });

  it("marks people who could have taken a shift as free", () => {
    // Sat Kitchen goes to Tom (his preference); Mei could have done it too.
    const e = explainShift(input, result, "sh_16");
    expect(e.assignee!.staffId).toBe("st_tom");
    expect(cand(e, "st_mei")).toMatchObject({ status: "free", detail: "free, but not chosen" });
    expect(cand(e, "st_ana")).toMatchObject({ status: "blocked", reason: "role", detail: "doesn't work kitchen" });
  });

  it("explains the uncovered shift with the same blockers as the solver", () => {
    const e = explainShift(input, result, "sh_18");
    expect(e.assignee).toBeNull();
    const [u] = result.uncovered;
    for (const b of u.blockers) {
      expect(cand(e, b.staffId)).toMatchObject({ status: "blocked", reason: b.reason, detail: b.detail });
    }
    expect(e.candidates.filter((c) => c.reason === "role")).toHaveLength(u.withoutRole);
  });

  it("rejects an unknown shift", () => {
    expect(() => explainShift(input, result, "sh_99")).toThrow();
  });
});
