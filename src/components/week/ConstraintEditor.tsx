"use client";

import { useId, useState } from "react";
import { api, ApiFailure, type ConstraintData, type WeekData } from "@/lib/client/api";
import { dayLabel } from "@/lib/client/describe";
import { weekDates } from "@/lib/domain/time";

const KINDS: [string, string][] = [
  ["unavailable", "Can't work"],
  ["available", "Can work after all"],
  ["prefer", "Would like"],
  ["prefer_not", "Would rather not"],
  ["max_shifts", "At most N shifts"],
  ["max_hours", "At most N hours"],
];

/** "Write it myself": the manager states the constraint exactly. It still needs confirming. */
export function ConstraintEditor({
  data,
  c,
  onSaved,
  onCancel,
}: {
  data: WeekData;
  c: ConstraintData;
  onSaved: (confirmNow: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const dates = weekDates(data.week.weekStart);
  const labels = [...new Set(data.shifts.map((s) => s.label))];
  const [staffId, setStaffId] = useState(c.staffId ?? "");
  const [kind, setKind] = useState(c.kind === "unknown" ? "unavailable" : c.kind);
  const [dateFrom, setDateFrom] = useState(c.dateFrom ?? dates[0]);
  const [dateTo, setDateTo] = useState(c.dateTo ?? c.dateFrom ?? dates[0]);
  const [timeFrom, setTimeFrom] = useState(c.timeFrom ?? "");
  const [timeTo, setTimeTo] = useState(c.timeTo ?? "");
  const [shiftLabel, setShiftLabel] = useState(c.shiftLabel ?? "");
  const [value, setValue] = useState(c.value != null ? String(c.value) : "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const isCap = kind === "max_shifts" || kind === "max_hours";

  async function save(confirmNow: boolean) {
    setBusy(true);
    setErrors({});
    setError(null);
    const body = isCap
      ? { staffId, kind, dateFrom: null, dateTo: null, timeFrom: null, timeTo: null, shiftLabel: null, value: Number(value) }
      : { staffId, kind, dateFrom, dateTo, timeFrom: timeFrom || null, timeTo: timeTo || null, daily: dateFrom !== dateTo && !!(timeFrom || timeTo), shiftLabel: shiftLabel || null, value: null };
    try {
      if (!staffId) throw new ApiFailure(422, "Choose who this is about.", "validation_failed", [{ path: "staffId", message: "Choose who this is about." }]);
      await api(`/api/constraints/${c.id}`, { method: "PATCH", body });
      await onSaved(confirmNow);
    } catch (e) {
      if (e instanceof ApiFailure && e.details) setErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      setBusy(false);
    }
  }

  const field = "min-h-11 rounded-md border-[1.5px] border-[#8a7a66] bg-white px-2 text-[15px]";
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="flex flex-col gap-2.5 rounded-lg border-2 border-ink bg-paper px-3 py-3" data-testid="constraint-editor">
      <span className="text-[15px] font-bold">Write it yourself</span>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-bold" htmlFor={`${id}-who`}>
          Who
          <select id={`${id}-who`} value={staffId} onChange={(e) => setStaffId(e.target.value)} className={field} aria-invalid={!!errors.staffId}>
            <option value="">Choose…</option>
            {data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {errors.staffId && <span className="font-normal text-problem">{errors.staffId}</span>}
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-bold" htmlFor={`${id}-kind`}>
          What
          <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {isCap ? (
          <label className="flex flex-col gap-1 text-[13px] font-bold" htmlFor={`${id}-value`}>
            {kind === "max_shifts" ? "Shifts" : "Hours"}
            <input id={`${id}-value`} type="number" min={1} max={80} value={value} onChange={(e) => setValue(e.target.value)} className={field} aria-invalid={!!errors.value} />
            {errors.value && <span className="font-normal text-problem">{errors.value}</span>}
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[13px] font-bold" htmlFor={`${id}-from`}>
              From day
              <select id={`${id}-from`} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); if (dateTo < e.target.value) setDateTo(e.target.value); }} className={field}>
                {dates.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold" htmlFor={`${id}-to`}>
              To day
              <select id={`${id}-to`} value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={field} aria-invalid={!!errors.dateTo}>
                {dates.filter((d) => d >= dateFrom).map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold" htmlFor={`${id}-shift`}>
              Only this shift
              <select id={`${id}-shift`} value={shiftLabel} onChange={(e) => setShiftLabel(e.target.value)} className={field}>
                <option value="">Any shift</option>
                {labels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold" htmlFor={`${id}-tf`}>
              From time (optional)
              <input id={`${id}-tf`} type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold" htmlFor={`${id}-tt`}>
              Until time (optional)
              <input id={`${id}-tt`} type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} className={field} />
            </label>
          </>
        )}
      </div>
      {error && !Object.keys(errors).length && <p role="alert" className="m-0 text-[14px] text-problem">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-confirmed px-3.5 text-[15px] font-bold text-white disabled:opacity-70">
          {busy ? "Saving…" : "Save and confirm"}
        </button>
        <button type="button" disabled={busy} onClick={() => save(false)} className="min-h-11 rounded-lg border-[1.5px] border-[#8a7a66] bg-paper px-3.5 text-[15px]">
          Save as proposed
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 px-2 text-[15px] text-muted">Cancel</button>
      </div>
    </form>
  );
}
