import { describe, expect, it } from "vitest";
import type { ResolvedConstraint, Shift, StaffMember } from "@/lib/domain/types";
import { dayWindow, localToInstant, shiftInstants } from "@/lib/domain/time";
import { blockingConstraint, describeUnavailability, effectiveCaps, isUnavailable, preferenceScore, type WindowConstraint } from "./availability";

const ZONE = "Europe/London";
const shift = (id: string, localDate: string, start: string, end: string, label = "Open"): Shift => ({
  id,
  label,
  role: "keyholder",
  localDate,
  startLocal: start,
  endLocal: end,
  ...shiftInstants(localDate, start, end, ZONE),
});
const win = (id: string, kind: WindowConstraint["kind"], start: string, end: string, sentAt: string, shiftLabel: string | null = null): WindowConstraint => ({
  id,
  staffId: "st_x",
  kind,
  start,
  end,
  shiftLabel,
  sentAt,
  quote: id,
});
const T1 = "2026-10-14T08:00:00.000Z";
const T2 = "2026-10-15T08:00:00.000Z";
const at = (d: string, t: string) => localToInstant(d, t, ZONE);

describe("unavailability details", () => {
  const sat = dayWindow("2026-10-24", ZONE);
  const s = shift("s", "2026-10-24", "14:00", "22:00", "Close");
  it.each([
    [sat.start, sat.end, null, "unavailable all day Sat 24 Oct"],
    [at("2026-10-24", "16:00"), sat.end, null, "unavailable from 16:00 on Sat 24 Oct"],
    [sat.start, at("2026-10-24", "11:00"), null, "unavailable until 11:00 on Sat 24 Oct"],
    [sat.start, sat.end, "Close", "unavailable for Close on Sat 24 Oct"],
    [at("2026-10-24", "12:00"), at("2026-10-24", "15:00"), null, "unavailable 12:00–15:00 on Sat 24 Oct"],
    [dayWindow("2026-10-19", ZONE).start, dayWindow("2026-10-21", ZONE).end, null, "unavailable all day Mon 19 Oct to Wed 21 Oct"],
    [at("2026-10-23", "18:00"), at("2026-10-24", "15:00"), null, "unavailable from 18:00 Fri 23 Oct to 15:00 Sat 24 Oct"],
  ])("%s .. %s (%s)", (start, end, label, expected) => {
    expect(describeUnavailability(win("c", "unavailable", start, end, T1, label), s, ZONE)).toBe(expected);
  });

  it("handles the 25 h Sunday as one whole day", () => {
    const sun = dayWindow("2026-10-25", ZONE);
    expect(Date.parse(sun.end) - Date.parse(sun.start)).toBe(25 * 3_600_000);
    expect(describeUnavailability(win("c", "unavailable", sun.start, sun.end, T1), shift("x", "2026-10-25", "08:00", "16:00"), ZONE)).toBe("unavailable all day Sun 25 Oct");
  });
});

describe("available exceptions", () => {
  const sat = dayWindow("2026-10-24", ZONE);
  const close = shift("close", "2026-10-24", "14:00", "22:00", "Close");
  const off = win("c1", "unavailable", sat.start, sat.end, T1);

  it("a later available carves the exception (label compared case-insensitively)", () => {
    expect(isUnavailable("st_x", close, [off])).toBe(true);
    expect(isUnavailable("st_x", close, [off, win("c2", "available", sat.start, sat.end, T2, "close")])).toBe(false);
  });

  it("an earlier or same-instant available does not", () => {
    expect(isUnavailable("st_x", close, [off, win("c2", "available", sat.start, sat.end, "2026-10-13T08:00:00.000Z")])).toBe(true);
    expect(isUnavailable("st_x", close, [off, win("c2", "available", sat.start, sat.end, T1)])).toBe(true);
  });

  it("a later unavailability wins over an earlier available", () => {
    const avail = win("c1", "available", sat.start, sat.end, T1);
    const later = win("c2", "unavailable", sat.start, sat.end, T2);
    expect(blockingConstraint("st_x", close, [avail, later], ZONE)).toMatchObject({ constraintId: "c2" });
  });

  it("is a set difference: partial windows leave the rest blocked, adjacent ones combine", () => {
    const from16 = win("c2", "available", at("2026-10-24", "16:00"), sat.end, T2);
    const until16 = win("c3", "available", sat.start, at("2026-10-24", "16:00"), T2);
    expect(isUnavailable("st_x", close, [off, from16])).toBe(true);
    expect(isUnavailable("st_x", close, [off, from16, until16])).toBe(false);
    // A Fri night shift running into Sat is blocked by "sat off" (overlap) and freed by a later "available sat".
    const friNight = shift("n", "2026-10-23", "22:00", "06:00", "Night bake");
    expect(isUnavailable("st_x", friNight, [off])).toBe(true);
    expect(isUnavailable("st_x", friNight, [off, win("c4", "available", sat.start, sat.end, T2)])).toBe(false);
  });

  it("ignores other people's constraints", () => {
    expect(isUnavailable("st_y", close, [off])).toBe(false);
  });
});

describe("preferences and caps", () => {
  it("prefer matches by shift start inside the window", () => {
    const morning = win("c1", "prefer", dayWindow("2026-10-24", ZONE).start, at("2026-10-24", "12:00"), T1);
    expect(preferenceScore("st_x", shift("a", "2026-10-24", "10:00", "18:00"), [morning])).toBe(1); // ends 18:00, starts in window
    expect(preferenceScore("st_x", shift("b", "2026-10-24", "12:00", "18:00"), [morning])).toBe(0); // starts at the window end
    const not = win("c2", "prefer_not", morning.start, morning.end, T1);
    expect(preferenceScore("st_x", shift("a", "2026-10-24", "10:00", "18:00"), [morning, not, { ...not, id: "c3" }])).toBe(-1);
  });

  it("the effective cap is the minimum of record, rule pack and constraints", () => {
    const pack = { name: "House rules", version: 3, effectiveFrom: "2026-10-19", minRestHours: 11, maxHoursDefault: 40, maxShiftsPerDay: 1 };
    const person: StaffMember = { id: "st_x", name: "X", aliases: [], roles: ["barista"], maxHours: 48 };
    expect(effectiveCaps(person, [], pack)).toMatchObject({ maxHours: 40, maxShifts: null, hoursConstraint: null, shiftsConstraint: null });
    const caps: ResolvedConstraint[] = [
      { id: "c2", staffId: "st_x", kind: "max_hours", value: 30, sentAt: T1, quote: "30" },
      { id: "c1", staffId: "st_x", kind: "max_hours", value: 20, sentAt: T1, quote: "20" },
      { id: "c3", staffId: "st_x", kind: "max_shifts", value: 2, sentAt: T1, quote: "2" },
      { id: "c4", staffId: "st_y", kind: "max_hours", value: 1, sentAt: T1, quote: "other" },
    ];
    const e = effectiveCaps({ ...person, maxShifts: 3 }, caps, pack);
    expect(e).toMatchObject({ maxHours: 20, maxShifts: 2 });
    expect(e.hoursConstraint?.id).toBe("c1");
    expect(e.shiftsConstraint?.id).toBe("c3");
    expect(effectiveCaps({ ...person, maxShifts: 1 }, caps, pack)).toMatchObject({ maxShifts: 1, shiftsConstraint: null });
  });
});
