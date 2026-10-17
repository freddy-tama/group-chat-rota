import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { shareView } from "@/lib/server/publish";
import { ApiError } from "@/lib/server/http";
import { dayLabel, hoursLabel } from "@/lib/client/describe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your shifts · Group Chat Rota", robots: { index: false } };

const TILTS = ["-0.6deg", "0.5deg", "-0.4deg", "0.3deg", "-0.2deg"];

export default async function StaffLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let view: Awaited<ReturnType<typeof shareView>> | null = null;
  try {
    view = await shareView(await getDb(), token);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  if (!view) {
    return (
      <main className="cork flex min-h-screen items-center justify-center px-4">
        <div className="ruled max-w-[420px] rounded-md px-6 py-6 shadow-[0_8px_18px_rgba(40,20,5,.4)]" role="alert">
          <h1 className="m-0 font-display text-2xl font-extrabold">This link doesn&rsquo;t work</h1>
          <p className="mb-0 text-base">It may have been mistyped or replaced. Ask your manager in the group chat for a new one.</p>
        </div>
      </main>
    );
  }
  const first = view.staff.name.split(" ")[0];
  return (
    <main className="cork min-h-screen px-4 py-6">
      <div className="mx-auto flex max-w-[460px] flex-col gap-3.5" data-testid="staff-view">
        <div className="on-cork flex flex-col gap-0.5">
          <span className="text-sm">{view.workspace.name} · week of {dayLabel(view.week.weekStart)}</span>
          <h1 className="m-0 font-display text-[30px] font-extrabold">{first}&rsquo;s shifts</h1>
        </div>
        <div className="ruled flex items-baseline gap-2.5 rounded-md px-4 py-3.5 shadow-[0_6px_14px_rgba(40,20,5,.35)]">
          <span className="font-display text-[40px] font-extrabold" data-testid="staff-hours">{view.totals.hoursLabel}</span>
          <span className="text-base">
            {view.totals.shifts} {view.totals.shifts === 1 ? "shift" : "shifts"} · cap {view.totals.maxHours} h
          </span>
        </div>
        {view.shifts.length === 0 && <p className="on-cork m-0 text-base">No shifts for you this week.</p>}
        {view.shifts.map((s, i) => (
          <div key={s.start} className="ruled flex flex-col gap-1 rounded px-3.5 py-3 shadow-[0_4px_10px_rgba(40,20,5,.35)]" style={{ transform: `rotate(${TILTS[i % TILTS.length]})` }} data-testid="staff-shift">
            <span className="text-sm font-bold text-ink-soft">{dayLabel(s.localDate)}{s.endLocal <= s.startLocal ? " → next morning" : ""}</span>
            <span className="font-hand text-[28px] leading-[1.05] font-bold">
              {s.label} · {s.startLocal}–{s.endLocal}
            </span>
            <span className="text-sm">
              {hoursLabel(s.hours)}
              {s.crossesClockChange ? " · clocks go back at 02:00, so this shift is an hour longer" : ""}
            </span>
          </div>
        ))}
        <section className="flex flex-col gap-1 rounded-md bg-paper-warm px-3.5 py-3 text-sm shadow-[0_4px_10px_rgba(40,20,5,.3)]" data-testid="fairness-receipt">
          <strong className="text-[15px]">Fairness receipt</strong>
          <span>Checked against {view.receipt.rulePack}</span>
          <span>
            {view.receipt.shortRestGaps} rest gaps under {view.receipt.restRuleHours} h on the team
            {view.totals.minRestHours != null ? ` · your shortest rest ${hoursLabel(view.totals.minRestHours)}` : ""}
          </span>
          <span>{view.receipt.covered}/{view.receipt.total} shifts covered this week</span>
        </section>
        <p className="on-cork m-0 text-xs">Read-only link. Ask in the group chat to change anything.</p>
      </div>
    </main>
  );
}
