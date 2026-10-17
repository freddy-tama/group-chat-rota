// The seeded Corner Café demo week, written out as data exactly per docs/DOMAIN.md.
// Synthetic: every name and message is invented for the demo.
//
// Shift instants are derived from the local table with shiftInstants (DST-correct). Messages and
// constraint sentAt values are written out literally (nothing is parsed at runtime); a test checks
// them against the chat block in DOMAIN.md.
//
// Constraint ids follow message order, so sorting by id equals sorting by sentAt. One table row in
// DOMAIN.md can become several resolved constraints because ResolvedConstraint has one window and
// one optional label:
//   - Kofi "can do any mornings" -> c_10..c_16, one prefer window 00:00-12:00 per rota day.
//   - Tom "can do sat kitchen + sun brunch" -> c_19 (Sat Kitchen) and c_20 (Sun Brunch).
//
// Matching rules (implemented in src/lib/solver/availability.ts):
//   - unavailable: blocks a shift whose interval OVERLAPS the window (and has the label, if given);
//   - prefer / prefer_not: match a shift whose START instant lies inside [start, end) (and label).
//     That is why "mornings (shifts starting before 12:00)" is a 00:00-12:00 window per day.

import type { FairnessHistory, Pin, ResolvedConstraint, Role, RulePack, Shift, SolveInput, StaffMember } from "@/lib/domain/types";
import { dayWindow, localToInstant, shiftInstants, weekdayInWeek, type Weekday } from "@/lib/domain/time";

const ZONE = "Europe/London";
const WEEK_START = "2026-10-19";

const day = (d: Weekday) => weekdayInWeek(d, WEEK_START);
const at = (d: Weekday, time: string) => localToInstant(day(d), time, ZONE);
const allDay = (d: Weekday) => dayWindow(day(d), ZONE);

export const CORNER_CAFE_STAFF: StaffMember[] = [
  { id: "st_ana", name: "Ana Costa", aliases: ["ana"], roles: ["keyholder", "barista"], maxHours: 40 },
  { id: "st_ben", name: "Ben Okafor", aliases: ["ben"], roles: ["keyholder", "barista"], maxHours: 40 },
  { id: "st_dara", name: "Dara Kim", aliases: ["dara"], roles: ["keyholder", "barista"], maxHours: 40 },
  { id: "st_sam", name: "Sam Lee", aliases: ["sam", "sammy"], roles: ["keyholder", "barista"], maxHours: 24 },
  { id: "st_priya", name: "Priya Nair", aliases: ["priya"], roles: ["baker"], maxHours: 30 },
  { id: "st_kofi", name: "Kofi Mensah", aliases: ["kofi"], roles: ["barista"], maxHours: 32 },
  { id: "st_mei", name: "Mei Tanaka", aliases: ["mei"], roles: ["kitchen", "barista"], maxHours: 32 },
  { id: "st_tom", name: "Tom Byrne", aliases: ["tom"], roles: ["kitchen"], maxHours: 40 },
  { id: "st_jo", name: "Jo Silva", aliases: ["jo"], roles: ["barista"], maxHours: 20 },
];

const SHIFT_TABLE: [id: string, day: Weekday, label: string, startLocal: string, endLocal: string, role: Role][] = [
  ["sh_01", "mon", "Open", "07:00", "15:00", "keyholder"],
  ["sh_02", "mon", "Close", "14:00", "22:00", "keyholder"],
  ["sh_03", "tue", "Open", "07:00", "15:00", "keyholder"],
  ["sh_04", "tue", "Close", "14:00", "22:00", "keyholder"],
  ["sh_05", "wed", "Open", "07:00", "15:00", "keyholder"],
  ["sh_06", "wed", "Close", "14:00", "22:00", "keyholder"],
  ["sh_07", "wed", "Night bake", "22:00", "06:00", "baker"],
  ["sh_08", "thu", "Open", "07:00", "15:00", "keyholder"],
  ["sh_09", "thu", "Kitchen", "11:00", "17:00", "kitchen"],
  ["sh_10", "thu", "Close", "14:00", "22:00", "keyholder"],
  ["sh_11", "fri", "Open", "07:00", "15:00", "keyholder"],
  ["sh_12", "fri", "Kitchen", "11:00", "17:00", "kitchen"],
  ["sh_13", "fri", "Close", "14:00", "22:00", "keyholder"],
  ["sh_14", "fri", "Night bake", "22:00", "06:00", "baker"],
  ["sh_15", "sat", "Open", "07:00", "15:00", "keyholder"],
  ["sh_16", "sat", "Kitchen", "10:00", "16:00", "kitchen"],
  ["sh_17", "sat", "Mid", "10:00", "18:00", "barista"],
  ["sh_18", "sat", "Close", "14:00", "22:00", "keyholder"],
  ["sh_19", "sat", "Night bake", "22:00", "06:00", "baker"], // 9 h: clocks go back Sun 25 Oct 02:00
  ["sh_20", "sun", "Open", "08:00", "16:00", "keyholder"],
  ["sh_21", "sun", "Brunch", "09:00", "15:00", "kitchen"],
  ["sh_22", "sun", "Close", "12:00", "18:00", "keyholder"],
];

export const CORNER_CAFE_SHIFTS: Shift[] = SHIFT_TABLE.map(([id, d, label, startLocal, endLocal, role]) => {
  const localDate = day(d);
  const { start, end, hours } = shiftInstants(localDate, startLocal, endLocal, ZONE);
  return { id, label, role, localDate, startLocal, endLocal, start, end, hours };
});

export const CORNER_CAFE_PINS: Pin[] = ["sh_02", "sh_04", "sh_06", "sh_10", "sh_13"].map((shiftId) => ({
  shiftId,
  staffId: "st_ben",
  reason: "Contract: weekday closes",
}));

export const CORNER_CAFE_RULE_PACKS: RulePack[] = [
  { name: "House rules", version: 2, effectiveFrom: "2026-09-01", minRestHours: 10, maxHoursDefault: 40, maxShiftsPerDay: 1 },
  { name: "House rules", version: 3, effectiveFrom: "2026-10-19", minRestHours: 11, maxHoursDefault: 40, maxShiftsPerDay: 1 },
];

/** Less-wanted shifts worked over the 3 weeks before 19 Oct (synthetic, fixed). */
export const CORNER_CAFE_HISTORY: FairnessHistory[] = [
  { staffId: "st_ana", weeks: 3, closes: 2, weekends: 3, nights: 0 },
  { staffId: "st_ben", weeks: 3, closes: 15, weekends: 1, nights: 0 },
  { staffId: "st_dara", weeks: 3, closes: 3, weekends: 4, nights: 0 },
  { staffId: "st_sam", weeks: 3, closes: 2, weekends: 2, nights: 0 },
  { staffId: "st_priya", weeks: 3, closes: 0, weekends: 3, nights: 9 },
  { staffId: "st_kofi", weeks: 3, closes: 0, weekends: 2, nights: 0 },
  { staffId: "st_mei", weeks: 3, closes: 0, weekends: 3, nights: 0 },
  { staffId: "st_tom", weeks: 3, closes: 0, weekends: 3, nights: 0 },
  { staffId: "st_jo", weeks: 3, closes: 0, weekends: 2, nights: 0 },
];

/** The WhatsApp (iOS copy format) block from DOMAIN.md, byte for byte. */
export const CORNER_CAFE_CHAT_TEXT = [
  "[14/10/2026, 08:30:12] Lou: Rota for w/c 19 Oct goes up Sunday night. Tell me what you can't do 🙏",
  "[14/10/2026, 09:12:40] Ana: sat off pls 🙏",
  "[14/10/2026, 09:40:03] Ben: usual for me 👍",
  "[14/10/2026, 12:03:55] Sam: can't do tues after 4, also need sat off",
  "[14/10/2026, 18:22:10] Dara: no sat close for me sorry, gig that night 🎸",
  "[15/10/2026, 07:55:31] Priya: bakes as normal 👍",
  "[15/10/2026, 10:31:18] Mei: I can do kitchen thurs + fri, not sun (church)",
  "[15/10/2026, 13:47:02] Tom: away mon-wed, back thurs",
  "[16/10/2026, 08:15:44] Jo: exams next week so max 2 shifts please",
  "[16/10/2026, 16:20:09] Kofi: can do any mornings, no closes",
  "[17/10/2026, 09:10:27] Sam: oh and fri morning dentist till 11",
  "[17/10/2026, 14:30:51] Kofi: sat mid fine 👍",
  "[18/10/2026, 10:05:36] Tom: can do sat kitchen + sun brunch",
  "[18/10/2026, 19:40:14] Ana: sorry also can't do sun close, family dinner",
].join("\n");

export interface DemoMessage {
  id: string;
  author: string; // display name as it appears in the chat
  sentLocal: string; // workspace-local wall clock, "YYYY-MM-DDTHH:MM:SS"
  sentAt: string; // UTC instant (BST = UTC+1 all of 14-18 Oct)
  text: string;
}

export const CORNER_CAFE_MESSAGES: DemoMessage[] = [
  { id: "m_01", author: "Lou", sentLocal: "2026-10-14T08:30:12", sentAt: "2026-10-14T07:30:12.000Z", text: "Rota for w/c 19 Oct goes up Sunday night. Tell me what you can't do 🙏" },
  { id: "m_02", author: "Ana", sentLocal: "2026-10-14T09:12:40", sentAt: "2026-10-14T08:12:40.000Z", text: "sat off pls 🙏" },
  { id: "m_03", author: "Ben", sentLocal: "2026-10-14T09:40:03", sentAt: "2026-10-14T08:40:03.000Z", text: "usual for me 👍" },
  { id: "m_04", author: "Sam", sentLocal: "2026-10-14T12:03:55", sentAt: "2026-10-14T11:03:55.000Z", text: "can't do tues after 4, also need sat off" },
  { id: "m_05", author: "Dara", sentLocal: "2026-10-14T18:22:10", sentAt: "2026-10-14T17:22:10.000Z", text: "no sat close for me sorry, gig that night 🎸" },
  { id: "m_06", author: "Priya", sentLocal: "2026-10-15T07:55:31", sentAt: "2026-10-15T06:55:31.000Z", text: "bakes as normal 👍" },
  { id: "m_07", author: "Mei", sentLocal: "2026-10-15T10:31:18", sentAt: "2026-10-15T09:31:18.000Z", text: "I can do kitchen thurs + fri, not sun (church)" },
  { id: "m_08", author: "Tom", sentLocal: "2026-10-15T13:47:02", sentAt: "2026-10-15T12:47:02.000Z", text: "away mon-wed, back thurs" },
  { id: "m_09", author: "Jo", sentLocal: "2026-10-16T08:15:44", sentAt: "2026-10-16T07:15:44.000Z", text: "exams next week so max 2 shifts please" },
  { id: "m_10", author: "Kofi", sentLocal: "2026-10-16T16:20:09", sentAt: "2026-10-16T15:20:09.000Z", text: "can do any mornings, no closes" },
  { id: "m_11", author: "Sam", sentLocal: "2026-10-17T09:10:27", sentAt: "2026-10-17T08:10:27.000Z", text: "oh and fri morning dentist till 11" },
  { id: "m_12", author: "Kofi", sentLocal: "2026-10-17T14:30:51", sentAt: "2026-10-17T13:30:51.000Z", text: "sat mid fine 👍" },
  { id: "m_13", author: "Tom", sentLocal: "2026-10-18T10:05:36", sentAt: "2026-10-18T09:05:36.000Z", text: "can do sat kitchen + sun brunch" },
  { id: "m_14", author: "Ana", sentLocal: "2026-10-18T19:40:14", sentAt: "2026-10-18T18:40:14.000Z", text: "sorry also can't do sun close, family dinner" },
];

const SENT = {
  ana14: "2026-10-14T08:12:40.000Z",
  sam14: "2026-10-14T11:03:55.000Z",
  dara14: "2026-10-14T17:22:10.000Z",
  mei15: "2026-10-15T09:31:18.000Z",
  tom15: "2026-10-15T12:47:02.000Z",
  jo16: "2026-10-16T07:15:44.000Z",
  kofi16: "2026-10-16T15:20:09.000Z",
  sam17: "2026-10-17T08:10:27.000Z",
  kofi17: "2026-10-17T13:30:51.000Z",
  tom18: "2026-10-18T09:05:36.000Z",
  ana18: "2026-10-18T18:40:14.000Z",
} as const;

const ROTA_DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Kofi "can do any mornings": a prefer window 00:00-12:00 on each rota day (prefer matches by
// shift start, so this means "shifts starting before 12:00"). Ids c_10..c_16, Mon..Sun.
const KOFI_MORNINGS: ResolvedConstraint[] = ROTA_DAYS.map((d, i) => ({
  id: `c_${String(10 + i).padStart(2, "0")}`,
  staffId: "st_kofi",
  kind: "prefer" as const,
  start: allDay(d).start,
  end: at(d, "12:00"),
  shiftLabel: null,
  sentAt: SENT.kofi16,
  quote: "can do any mornings",
}));

export const CORNER_CAFE_CONSTRAINTS: ResolvedConstraint[] = [
  { id: "c_01", staffId: "st_ana", kind: "unavailable", ...allDay("sat"), shiftLabel: null, sentAt: SENT.ana14, quote: "sat off pls" },
  // "from 16:00" = 16:00 to the end of that local day.
  { id: "c_02", staffId: "st_sam", kind: "unavailable", start: at("tue", "16:00"), end: allDay("tue").end, shiftLabel: null, sentAt: SENT.sam14, quote: "can't do tues after 4" },
  { id: "c_03", staffId: "st_sam", kind: "unavailable", ...allDay("sat"), shiftLabel: null, sentAt: SENT.sam14, quote: "need sat off" },
  { id: "c_04", staffId: "st_dara", kind: "unavailable", ...allDay("sat"), shiftLabel: "Close", sentAt: SENT.dara14, quote: "no sat close for me sorry" },
  { id: "c_05", staffId: "st_mei", kind: "unavailable", ...allDay("sun"), shiftLabel: null, sentAt: SENT.mei15, quote: "not sun (church)" },
  { id: "c_06", staffId: "st_mei", kind: "prefer", start: allDay("thu").start, end: allDay("fri").end, shiftLabel: "Kitchen", sentAt: SENT.mei15, quote: "I can do kitchen thurs + fri" },
  { id: "c_07", staffId: "st_tom", kind: "unavailable", start: allDay("mon").start, end: allDay("wed").end, shiftLabel: null, sentAt: SENT.tom15, quote: "away mon-wed" },
  { id: "c_08", staffId: "st_jo", kind: "max_shifts", value: 2, sentAt: SENT.jo16, quote: "max 2 shifts please" },
  // "every Close" = a Close-only window covering the whole rota week.
  { id: "c_09", staffId: "st_kofi", kind: "unavailable", start: allDay("mon").start, end: allDay("sun").end, shiftLabel: "Close", sentAt: SENT.kofi16, quote: "no closes" },
  ...KOFI_MORNINGS,
  // "until 11:00" = start of that local day to 11:00.
  { id: "c_17", staffId: "st_sam", kind: "unavailable", start: allDay("fri").start, end: at("fri", "11:00"), shiftLabel: null, sentAt: SENT.sam17, quote: "fri morning dentist till 11" },
  { id: "c_18", staffId: "st_kofi", kind: "prefer", ...allDay("sat"), shiftLabel: "Mid", sentAt: SENT.kofi17, quote: "sat mid fine" },
  { id: "c_19", staffId: "st_tom", kind: "prefer", ...allDay("sat"), shiftLabel: "Kitchen", sentAt: SENT.tom18, quote: "can do sat kitchen + sun brunch" },
  { id: "c_20", staffId: "st_tom", kind: "prefer", ...allDay("sun"), shiftLabel: "Brunch", sentAt: SENT.tom18, quote: "can do sat kitchen + sun brunch" },
  { id: "c_21", staffId: "st_ana", kind: "unavailable", ...allDay("sun"), shiftLabel: "Close", sentAt: SENT.ana18, quote: "can't do sun close" },
];

export const CORNER_CAFE = {
  workspaceName: "Corner Café",
  timezone: ZONE,
  managerName: "Lou",
  weekStart: WEEK_START,
  staff: CORNER_CAFE_STAFF,
  shifts: CORNER_CAFE_SHIFTS,
  pins: CORNER_CAFE_PINS,
  rulePacks: CORNER_CAFE_RULE_PACKS,
  history: CORNER_CAFE_HISTORY,
  chatText: CORNER_CAFE_CHAT_TEXT,
  messages: CORNER_CAFE_MESSAGES,
  seedConstraints: CORNER_CAFE_CONSTRAINTS,
};

/** The rule pack in force for a week: the latest one with effectiveFrom <= weekStart. */
export function activeRulePack(weekStart: string, packs: RulePack[] = CORNER_CAFE_RULE_PACKS): RulePack {
  const applicable = packs
    .filter((p) => p.effectiveFrom <= weekStart)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : a.version - b.version));
  const pack = applicable[applicable.length - 1];
  if (!pack) throw new Error(`No rule pack is in force for the week of ${weekStart}`);
  return pack;
}

/** A fresh SolveInput for the demo week (deep copies, so callers may mutate it). */
export function buildCornerCafeInput(extraConstraints: ResolvedConstraint[] = []): SolveInput {
  return structuredClone({
    timezone: CORNER_CAFE.timezone,
    weekStart: CORNER_CAFE.weekStart,
    shifts: CORNER_CAFE.shifts,
    staff: CORNER_CAFE.staff,
    constraints: [...CORNER_CAFE.seedConstraints, ...extraConstraints],
    pins: CORNER_CAFE.pins,
    rulePack: activeRulePack(CORNER_CAFE.weekStart, CORNER_CAFE.rulePacks),
    history: CORNER_CAFE.history,
  });
}
