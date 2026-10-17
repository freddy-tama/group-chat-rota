"use client";

import type { ShiftData, SolutionData, StaffData, WeekData } from "@/lib/client/api";
import { dayLabel, hoursLabel, shortDay } from "@/lib/client/describe";
import { weekDates } from "@/lib/domain/time";

export const ROLE_NEED: Record<string, string> = {
  keyholder: "a key holder",
  barista: "a barista",
  kitchen: "kitchen staff",
  baker: "a baker",
};

const TILTS = ["-0.6deg", "0.4deg", "-0.3deg", "0.5deg", "-0.5deg", "0.3deg", "0deg"];

export function RotaGrid({
  data,
  onOpen,
  highlight,
}: {
  data: WeekData;
  onOpen: (shiftId: string) => void;
  highlight?: string | null;
}) {
  const staffById = new Map(data.staff.map((s) => [s.id, s]));
  const assigned = new Map(data.solution.assignments.map((a) => [a.shiftId, a]));
  const uncovered = new Map(data.solution.uncovered.map((u) => [u.shiftId, u]));
  const pinReason = new Map(data.pins.map((p) => [p.shiftId, p.reason]));
  const days = weekDates(data.week.weekStart);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(108px,100%),1fr))] items-start gap-3" data-testid="rota-grid">
      {days.map((date, di) => {
        const shifts = data.shifts.filter((s) => s.localDate === date).sort((a, b) => a.start.localeCompare(b.start));
        return (
          <div key={date} className="flex flex-col gap-2.5" role="group" aria-label={dayLabel(date)}>
            <div className="rounded bg-ink px-2 py-1.5 text-center text-[15px] font-bold text-paper">{shortDay(date)}</div>
            {shifts.length === 0 && <div className="rounded bg-paper/70 px-2 py-2 text-center text-[13px] text-muted">No shifts</div>}
            {shifts.map((s, si) => (
              <ShiftCard
                key={s.id}
                shift={s}
                staff={assigned.has(s.id) ? staffById.get(assigned.get(s.id)!.staffId) : undefined}
                pinned={pinReason.get(s.id)}
                uncovered={uncovered.has(s.id)}
                tilt={TILTS[(di * 3 + si) % TILTS.length]}
                selected={highlight === s.id}
                onOpen={onOpen}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ShiftCard({
  shift,
  staff,
  pinned,
  uncovered,
  tilt,
  selected,
  onOpen,
}: {
  shift: ShiftData;
  staff?: StaffData;
  pinned?: string;
  uncovered: boolean;
  tilt: string;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const notes: string[] = [];
  if (uncovered) notes.push(`needs ${ROLE_NEED[shift.role] ?? shift.role}`);
  if (pinned) notes.push("pinned");
  if (shift.hours !== 8 || shift.crossesClockChange) notes.push(hoursLabel(shift.hours));
  if (shift.crossesClockChange) notes.push("clocks go back");
  const who = uncovered ? "Not covered" : staff ? staff.name.split(" ")[0] : "—";
  const label = `${dayLabel(shift.localDate)} ${shift.label} ${shift.startLocal}–${shift.endLocal}, ${uncovered ? "not covered" : `${staff?.name ?? "unassigned"}`}${pinned ? `, pinned: ${pinned}` : ""}. Open details.`;
  return (
    <button
      type="button"
      data-testid={`shift-card`}
      data-shift-id={shift.id}
      data-shift-key={shift.key}
      data-uncovered={uncovered || undefined}
      onClick={() => onOpen(shift.id)}
      aria-label={label}
      style={{ transform: `rotate(${tilt})` }}
      className={`ruled pinned-shadow relative flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-[3px] px-2.5 pt-2 pb-2.5 text-left transition-transform hover:-translate-y-0.5 ${
        uncovered ? "border-[2.5px] border-problem" : "border border-edge"
      } ${selected ? "outline-[3px] outline-[#2f6fbd] outline-solid" : ""}`}
    >
      <span
        aria-hidden="true"
        className="absolute -top-1.5 left-1/2 -ml-1.5 h-3 w-3 rounded-full shadow-[0_2px_3px_rgba(0,0,0,.4)]"
        style={{ background: uncovered ? "#e5484d" : pinned ? "#3d362c" : "#2f6fbd" }}
      />
      <span className="text-[13px] font-bold text-ink-soft">
        {shift.label} · {shift.startLocal.slice(0, 2)}–{shift.endLocal.slice(0, 2)}
      </span>
      <span className={`font-hand text-[26px] leading-[1.05] font-bold ${uncovered ? "text-problem" : "text-ink"}`}>{who}</span>
      {notes.length > 0 && <span className="text-xs text-muted">{notes.join(" · ")}</span>}
    </button>
  );
}

export function coverageLine(solution: SolutionData) {
  return `${solution.coverage.covered}/${solution.coverage.total}`;
}
