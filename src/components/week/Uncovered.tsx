"use client";

import type { WeekData } from "@/lib/client/api";
import { dayLabel } from "@/lib/client/describe";
import { ROLE_NEED } from "./RotaGrid";

/** One panel per uncovered shift: who could have taken it, and the exact reason each one can't. */
export function UncoveredPanels({ data, onOpen }: { data: WeekData; onOpen: (shiftId: string) => void }) {
  const staffById = new Map(data.staff.map((s) => [s.id, s]));
  if (data.solution.uncovered.length === 0) {
    return (
      <div className="ruled pinned-shadow max-w-[680px] rounded-md border-2 border-confirmed px-4 py-3 text-base" data-testid="all-covered">
        <strong>Every shift is covered.</strong> No rest gap under {data.solution.rulePack.minRestHours} h, nobody over their hours.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {data.solution.uncovered.map((u) => {
        const shift = data.shifts.find((s) => s.id === u.shiftId);
        if (!shift) return null;
        const need = ROLE_NEED[u.role] ?? u.role;
        return (
          <section
            key={u.shiftId}
            data-testid="uncovered-panel"
            data-uncovered-shift={shift.id}
            className="ruled flex max-w-[680px] flex-col gap-2 rounded-md border-[2.5px] border-problem px-4 py-3.5 shadow-[0_6px_16px_rgba(40,20,5,.35)]"
          >
            <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
              <h3 className="m-0 font-display text-xl font-extrabold text-problem">
                {dayLabel(shift.localDate)} {shift.label} · {shift.startLocal}–{shift.endLocal} · not covered
              </h3>
              <span className="text-[15px] font-bold">
                Needs {need}.{" "}
                {u.blockers.length > 0 ? `All ${u.blockers.length} ${u.blockers.length === 1 ? "is" : "are"} blocked:` : "Nobody on the team has that role."}
              </span>
            </div>
            {u.blockers.length > 0 && (
              <ul className="m-0 flex flex-col gap-1 pl-5 text-[15px]">
                {u.blockers.map((b) => (
                  <li key={b.staffId} data-testid="blocker">
                    <strong>{staffById.get(b.staffId)?.name.split(" ")[0] ?? "Someone"}</strong> {b.detail}
                    {b.quote && <>: &ldquo;{b.quote}&rdquo;</>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {u.withoutRole > 0 && (
                <span className="text-[13px] text-muted">
                  The other {u.withoutRole} staff {u.withoutRole === 1 ? "isn't" : "aren't"} {u.role === "keyholder" ? "key holders" : `${u.role} staff`}.
                </span>
              )}
              <button type="button" onClick={() => onOpen(shift.id)} className="min-h-11 rounded-lg border-[1.5px] border-[#8a7a66] bg-paper px-3 text-[14px] font-bold">
                See why
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
