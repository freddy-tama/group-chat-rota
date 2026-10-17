import { DateTime } from "luxon";
import { addDays, weekDates } from "@/lib/domain/time";

// Human sentences for constraints and shifts, shared by the board and the staff page.

export function dayLabel(localDate: string): string {
  return DateTime.fromISO(localDate, { zone: "UTC" }).toFormat("ccc d LLL");
}

export function shortDay(localDate: string): string {
  return DateTime.fromISO(localDate, { zone: "UTC" }).toFormat("ccc d");
}

export function hoursLabel(h: number): string {
  return `${h.toFixed(1)} h`;
}

export function timeRange(start: string, end: string): string {
  return `${start}–${end}`;
}

export function sentLabel(instant: string | null, zone: string): string {
  if (!instant) return "time not given";
  return DateTime.fromISO(instant, { zone: "UTC" }).setZone(zone).toFormat("ccc d · HH:mm");
}

const KIND_WORD: Record<string, string> = {
  unavailable: "Unavailable",
  available: "Available",
  prefer: "Prefers",
  prefer_not: "Rather not",
  max_shifts: "Cap",
  max_hours: "Cap",
  unknown: "Needs your answer",
};

export interface ConstraintLike {
  kind: string;
  dateFrom: string | null;
  dateTo: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  daily: boolean;
  shiftLabel: string | null;
  value: number | null;
}

/** "Unavailable · Tue 20 Oct from 16:00", "Unavailable · every Close", "Cap · at most 2 shifts". */
export function describeConstraint(c: ConstraintLike, weekStart: string): string {
  const word = KIND_WORD[c.kind] ?? c.kind;
  if (c.kind === "max_shifts") return `${word} · at most ${c.value} shifts this week`;
  if (c.kind === "max_hours") return `${word} · at most ${c.value} h this week`;
  if (c.kind === "unknown" || !c.dateFrom) return word;
  const dates = weekDates(weekStart);
  const to = c.dateTo ?? c.dateFrom;
  const wholeWeek = c.dateFrom === dates[0] && to === dates[6];
  let when: string;
  if (wholeWeek) when = c.shiftLabel ? `every ${c.shiftLabel}` : "all week";
  else if (c.dateFrom === to) when = dayLabel(c.dateFrom);
  else if (addDays(c.dateFrom, 1) === to) when = `${shortDay(c.dateFrom)} and ${dayLabel(to)}`;
  else when = `${shortDay(c.dateFrom)} to ${dayLabel(to)}`;
  const label = c.shiftLabel && !wholeWeek ? ` ${c.shiftLabel}` : "";
  let times = "";
  if (c.timeFrom && c.timeTo) times = ` ${c.timeFrom}–${c.timeTo}`;
  else if (c.timeFrom) times = ` from ${c.timeFrom}`;
  else if (c.timeTo) times = ` until ${c.timeTo}`;
  if (c.daily && times) {
    return `${word} · ${c.timeTo && !c.timeFrom && c.timeTo <= "12:00" ? "mornings" : times.trim()}${label}${wholeWeek ? ", every day" : `, ${when}`}`;
  }
  const allDay = !times && !c.shiftLabel && c.kind === "unavailable" && c.dateFrom === to ? ", all day" : "";
  return `${word} · ${when}${label}${times}${allDay}`;
}
