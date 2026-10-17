"use client";

import { useEffect, useRef, useState } from "react";
import { api, type WeekData } from "@/lib/client/api";
import { dayLabel, hoursLabel } from "@/lib/client/describe";
import { ROLE_NEED } from "./RotaGrid";

interface Candidate {
  staffId: string;
  status: "assigned" | "blocked" | "free";
  reason?: string;
  detail: string;
  quote?: string;
}

interface Why {
  shiftId: string;
  role: string;
  hours: number;
  crossesClockChange: boolean;
  assignee: null | {
    staffId: string;
    pinned: boolean;
    pinReason?: string;
    weekHours: number;
    cap: number;
    restBefore: null | { hours: number; otherShiftId: string };
    restAfter: null | { hours: number; otherShiftId: string };
  };
  candidates: Candidate[];
}

export function WhyDrawer({ data, shiftId, onClose }: { data: WeekData; shiftId: string; onClose: () => void }) {
  const [why, setWhy] = useState<Why | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const shift = data.shifts.find((s) => s.id === shiftId);
  const staff = new Map(data.staff.map((s) => [s.id, s]));
  const shiftName = (id: string) => {
    const s = data.shifts.find((x) => x.id === id);
    return s ? `${dayLabel(s.localDate)} ${s.label}` : "another shift";
  };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setWhy(null);
    setError(null);
    api<Why>(`/api/weeks/${data.week.id}/shifts/${shiftId}/why`)
      .then((w) => live && setWhy(w))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load the explanation."));
    return () => {
      live = false;
    };
  }, [data.week.id, shiftId, data.solution.objective.covered, data.counts.confirmed]);

  if (!shift) return null;
  const withRole = why?.candidates.filter((c) => c.reason !== "role") ?? [];
  const withoutRole = why?.candidates.filter((c) => c.reason === "role") ?? [];
  const freeOthers = withRole.filter((c) => c.status === "free").length;
  const a = why?.assignee;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="why-title"
        data-testid="why-panel"
        onClick={(e) => e.stopPropagation()}
        className="ruled flex h-full w-full max-w-[460px] flex-col gap-4 overflow-y-auto px-5 py-5 shadow-[-8px_0_24px_rgba(0,0,0,.35)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="why-title" className="m-0 font-display text-2xl font-extrabold">
              {dayLabel(shift.localDate)} {shift.label}
            </h2>
            <span className="text-[15px]">
              {shift.startLocal}–{shift.endLocal} · {hoursLabel(shift.hours)} · needs {ROLE_NEED[shift.role] ?? shift.role}
            </span>
            {shift.crossesClockChange && (
              <span className="text-[14px] font-bold text-ink-soft">Clocks go back at 02:00 during this shift, so it lasts {hoursLabel(shift.hours)}.</span>
            )}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg border-[1.5px] border-[#8a7a66] bg-paper px-3 text-[15px] font-bold">
            Close
          </button>
        </div>

        {error && <p role="alert" className="m-0 text-problem">{error}</p>}
        {!why && !error && <p className="m-0 text-muted">Checking every rule for this shift…</p>}

        {why && (
          <>
            <section className="flex flex-col gap-1.5 rounded-md bg-paper-warm px-3.5 py-3">
              {a ? (
                <>
                  <span className="text-[13px] font-bold tracking-wide text-muted uppercase">On this shift</span>
                  <span className="font-hand text-[30px] leading-none font-bold">{staff.get(a.staffId)?.name}</span>
                  <span className="text-[15px]">
                    {a.pinned ? `Pinned by the manager: ${a.pinReason}` : freeOthers === 0 ? `The only one with the role who could take it.` : `Chosen over ${freeOthers} other${freeOthers === 1 ? "" : "s"} who could, by fairness and preferences.`}
                  </span>
                  <span className="text-[15px]">Week so far: {hoursLabel(a.weekHours)} of {hoursLabel(a.cap)}</span>
                  {a.restBefore && <span className="text-[15px]">Rest since {shiftName(a.restBefore.otherShiftId)}: {hoursLabel(a.restBefore.hours)}</span>}
                  {a.restAfter && <span className="text-[15px]">Rest before {shiftName(a.restAfter.otherShiftId)}: {hoursLabel(a.restAfter.hours)}</span>}
                </>
              ) : (
                <span className="text-[15px] font-bold text-problem">Not covered: nobody with the role can take it under the current rules.</span>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-base font-bold">Everyone who could work it</h3>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {withRole.map((c) => (
                  <li key={c.staffId} data-testid="why-candidate" className="flex flex-col gap-0.5 rounded-md border border-edge bg-paper px-3 py-2 text-[15px]">
                    <span>
                      <strong>{staff.get(c.staffId)?.name.split(" ")[0]}</strong>{" "}
                      <span className={c.status === "blocked" ? "text-problem" : c.status === "assigned" ? "text-confirmed" : "text-ink-soft"}>
                        {c.status === "assigned" ? "on this shift" : c.detail}
                      </span>
                    </span>
                    {c.quote && <span className="text-[14px] text-ink-soft">&ldquo;{c.quote}&rdquo;</span>}
                  </li>
                ))}
              </ul>
              {withoutRole.length > 0 && (
                <p className="m-0 text-[14px] text-muted">
                  {withoutRole.map((c) => staff.get(c.staffId)?.name.split(" ")[0]).join(", ")} {withoutRole.length === 1 ? "doesn't" : "don't"} have the role.
                </p>
              )}
            </section>
            <p className="m-0 text-[13px] text-muted">
              Checked against {data.solution.rulePack.name} v{data.solution.rulePack.version}: rest of at least {data.solution.rulePack.minRestHours} h between shifts, measured in real hours across midnight and clock changes.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
