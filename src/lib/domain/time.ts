import { DateTime, Duration } from "luxon";

// Zoned time maths. Every duration and rest gap is measured between UTC instants, so a shift that
// crosses a clock change gets its real length (Sat 24 Oct 2026 22:00 -> Sun 06:00 in Europe/London
// is 9 h, because clocks go back at 02:00).

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Local wall-clock time on a local date -> UTC instant. Ambiguous times take the earlier offset. */
export function localToInstant(localDate: string, localTime: string, zone: string): string {
  const dt = DateTime.fromISO(`${localDate}T${localTime}`, { zone });
  if (!dt.isValid) throw new Error(`Invalid local time ${localDate} ${localTime} in ${zone}: ${dt.invalidReason}`);
  return dt.toUTC().toISO()!;
}

export function addDays(localDate: string, days: number): string {
  return DateTime.fromISO(localDate, { zone: "UTC" }).plus({ days }).toISODate()!;
}

/** Start and end instants for a shift; an end at or before the start means the next day. */
export function shiftInstants(localDate: string, startLocal: string, endLocal: string, zone: string) {
  const start = localToInstant(localDate, startLocal, zone);
  const endDate = endLocal <= startLocal ? addDays(localDate, 1) : localDate;
  const end = localToInstant(endDate, endLocal, zone);
  return { start, end, hours: hoursBetween(start, end) };
}

export function hoursBetween(startInstant: string, endInstant: string): number {
  const ms = Date.parse(endInstant) - Date.parse(startInstant);
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** The local date of an instant in a zone. */
export function instantToLocalDate(instant: string, zone: string): string {
  return DateTime.fromISO(instant, { zone: "UTC" }).setZone(zone).toISODate()!;
}

export function instantToLocalTime(instant: string, zone: string): string {
  return DateTime.fromISO(instant, { zone: "UTC" }).setZone(zone).toFormat("HH:mm");
}

export function weekdayOf(localDate: string): Weekday {
  const n = DateTime.fromISO(localDate, { zone: "UTC" }).weekday; // 1 = Monday
  return WEEKDAYS[n - 1];
}

/** The 7 local dates of the rota week starting on a Monday. */
export function weekDates(weekStart: string): string[] {
  return WEEKDAYS.map((_, i) => addDays(weekStart, i));
}

/** The date of a weekday inside the rota week ("sat" -> 2026-10-24 for the week of 19 Oct). */
export function weekdayInWeek(day: Weekday, weekStart: string): string {
  return addDays(weekStart, WEEKDAYS.indexOf(day));
}

/** Start and end instants of a whole local day (handles 23 h and 25 h days). */
export function dayWindow(localDate: string, zone: string) {
  return { start: localToInstant(localDate, "00:00", zone), end: localToInstant(addDays(localDate, 1), "00:00", zone) };
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

/** "Sat 24 Oct" */
export function formatDay(localDate: string): string {
  return DateTime.fromISO(localDate, { zone: "UTC" }).toFormat("ccc d LLL");
}

/** "9.0 h" */
export function formatHours(hours: number): string {
  return `${hours.toFixed(1)} h`;
}

/** True when the zone's UTC offset changes during the interval (a clock change happens inside it). */
export function crossesClockChange(startInstant: string, endInstant: string, zone: string): boolean {
  const a = DateTime.fromISO(startInstant, { zone: "UTC" }).setZone(zone).offset;
  const b = DateTime.fromISO(endInstant, { zone: "UTC" }).setZone(zone).offset;
  return a !== b;
}

export function durationLabel(hours: number): string {
  return Duration.fromObject({ hours }).toFormat("h'h' m'm'");
}
