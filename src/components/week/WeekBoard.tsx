"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFailure, type WeekData } from "@/lib/client/api";
import { dayLabel } from "@/lib/client/describe";
import { TryDemoButton } from "@/components/TryDemoButton";
import { Footer } from "@/components/Footer";
import { MessageList, PasteBox, type PasteOutcome } from "./ChatColumn";
import { RotaGrid } from "./RotaGrid";
import { UncoveredPanels } from "./Uncovered";
import { RedStrings, type StringLink } from "./RedStrings";
import { WhyDrawer } from "./WhyDrawer";
import { PublishButton, PublishedPanel, type Published } from "./PublishPanel";

interface PasteResponse {
  format: { app: string; dateOrder: { value: string; basis: string }; clock: string; warnings: string[]; skipped: unknown[] };
  aiMode: string;
  messages: { ai: { redactions: { count: number }[] } }[];
  constraints: { id: string }[];
}

export function WeekBoard({ weekId }: { weekId: string }) {
  const [data, setData] = useState<WeekData | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [published, setPublished] = useState<Published | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const week = await api<WeekData>(`/api/weeks/${weekId}`);
      setData(week);
      if (week.week.status === "published") setPublished(await api<Published>(`/api/weeks/${weekId}/publish`));
      setFailure(null);
    } catch (e) {
      setFailure(e instanceof ApiFailure ? e : new ApiFailure(0, "Couldn't load this week."));
    }
  }, [weekId]);

  useEffect(() => {
    load();
  }, [load]);

  const onPaste = useCallback(
    async (text: string): Promise<PasteOutcome> => {
      const res = await api<PasteResponse>(`/api/weeks/${weekId}/messages`, { body: { text, consent: true } });
      setFresh(new Set(res.constraints.map((c) => c.id)));
      await load();
      const proposed = res.constraints.length;
      setNotice(proposed ? `${proposed} new ${proposed === 1 ? "item" : "items"} to check. Nothing changes the rota until you confirm.` : "No constraints found in those messages.");
      return {
        app: res.format.app,
        dateOrder: res.format.dateOrder,
        clock: res.format.clock,
        messages: res.messages.length,
        skipped: res.format.skipped.length,
        redacted: res.messages.reduce((n, m) => n + m.ai.redactions.reduce((k, r) => k + r.count, 0), 0),
        warnings: res.format.warnings,
        aiMode: res.aiMode,
      };
    },
    [weekId, load],
  );

  const decide = useCallback(
    async (id: string, verb: "confirm" | "reject") => {
      const before = data?.solution.coverage.covered;
      try {
        await api(`/api/constraints/${id}/${verb}`, { method: "POST" });
        const next = await api<WeekData>(`/api/weeks/${weekId}`);
        setData(next);
        const after = next.solution.coverage;
        setNotice(
          verb === "confirm"
            ? `Confirmed. Rota re-solved: ${after.covered}/${after.total} covered${before != null && before !== after.covered ? ` (was ${before}/${after.total})` : ""}.`
            : "Rejected. It won't affect the rota.",
        );
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "That didn't work. Try again.");
      }
    },
    [data, weekId],
  );

  const links: StringLink[] = useMemo(() => {
    if (!data) return [];
    const msgOf = new Map(data.constraints.map((c) => [c.id, c.messageId]));
    const out: StringLink[] = [];
    for (const u of data.solution.uncovered) {
      for (const b of u.blockers) {
        const base = b.constraintId?.split("#")[0];
        const messageId = base ? msgOf.get(base) : null;
        if (messageId) out.push({ shiftId: u.shiftId, messageId });
      }
    }
    return out;
  }, [data]);
  const tied = useMemo(() => new Set(links.map((l) => l.messageId)), [links]);

  if (failure) return <LoadFailure failure={failure} />;
  if (!data) {
    return (
      <div className="cork flex min-h-screen items-center justify-center">
        <p className="on-cork text-xl" role="status">Pinning up this week&rsquo;s rota…</p>
      </div>
    );
  }

  const { coverage, uncovered, violations, rulePack } = data.solution;
  const shortRests = data.solution.totals.filter((t) => t.minRestHours != null && t.minRestHours < rulePack.minRestHours).length;
  const problems = uncovered.map((u) => {
    const s = data.shifts.find((x) => x.id === u.shiftId);
    return s ? `${dayLabel(s.localDate)} ${s.label}` : "";
  });

  return (
    <div className="cork flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-7 gap-y-3 bg-ink px-4 py-3.5 text-paper sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-paper no-underline">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e5484d" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="8" r="5" /><path d="M12 13v9" /></svg>
          <span className="font-display text-xl font-extrabold tracking-tight">Group Chat Rota</span>
        </Link>
        <div className="text-[15px] text-[#e8dcc8]">
          {data.workspace.name} · week of {dayLabel(data.week.weekStart)} {data.week.weekStart.slice(0, 4)} · {data.workspace.timezone}
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          {data.workspace.isDemo && <span className="rounded-full bg-[#3a332a] px-2.5 py-1.5 text-[13px] text-[#f3e6cf]">Demo workspace · yours for 24 h</span>}
          {data.week.status === "published" ? (
            <span className="rounded-full bg-confirmed px-2.5 py-1.5 text-[13px] font-bold text-white">Published</span>
          ) : (
            <PublishButton
              data={data}
              onPublished={(p) => {
                setPublished(p);
                setNotice("Published. The rota is locked and everyone has a private link.");
                load();
              }}
            />
          )}
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-[1376px] flex-wrap items-stretch gap-4 px-4 pt-6 pb-2 sm:px-8">
        <div className="ruled flex flex-[1_1_520px] -rotate-[0.4deg] flex-wrap items-center gap-x-7 gap-y-3 rounded-md px-6 py-4.5 shadow-[0_6px_18px_rgba(40,20,5,.35)]" data-testid="coverage">
          <div className="flex items-baseline gap-2.5" aria-label={`${coverage.covered} of ${coverage.total} shifts covered`}>
            <span className="font-display text-[56px] leading-none font-extrabold" data-testid="coverage-count">{coverage.covered}/{coverage.total}</span>
            <span className="text-xl font-bold">shifts covered</span>
          </div>
          <div className="flex flex-col gap-1 text-base">
            {uncovered.length > 0 ? (
              <span className="font-bold text-problem">
                {uncovered.length === 1 ? `1 needs ${needWord(uncovered[0].role)}: ${problems[0]}` : `${uncovered.length} not covered: ${problems.join(", ")}`}
              </span>
            ) : (
              <span className="font-bold text-confirmed">Every shift covered</span>
            )}
            <span data-testid="receipt-line">
              Checked against {rulePack.name} v{rulePack.version} · {shortRests} rest gaps under {rulePack.minRestHours} h · {violations.length} violations
            </span>
          </div>
        </div>
        <div className="flex flex-[0_1_360px] rotate-[0.6deg] flex-col gap-1.5 rounded-md bg-paper-warm px-5 py-4 shadow-[0_6px_18px_rgba(40,20,5,.35)]" data-testid="gate">
          <span className="text-[15px] font-bold">Only confirmed messages count</span>
          <span className="text-[15px]">
            {data.counts.confirmed} confirmed · {data.counts.proposed} waiting for you · {data.counts.ask} to ask about
          </span>
          <span className="text-[13px] text-muted">Solved in {data.solution.solvedInMs} ms · same chat, same rota, every time</span>
        </div>
      </section>

      {notice && (
        <div className="mx-auto w-full max-w-[1376px] px-4 sm:px-8">
          <p role="status" data-testid="notice" className="m-0 mt-2 rounded-md bg-ink px-4 py-2.5 text-[15px] text-paper">{notice}</p>
        </div>
      )}

      <div ref={boardRef} className="relative mx-auto flex w-full max-w-[1376px] flex-wrap gap-6 px-4 pt-4 pb-6 sm:px-8">
        <aside className="flex max-w-[400px] flex-[1_1_340px] flex-col gap-3.5">
          {data.week.status !== "published" && <PasteBox onPaste={onPaste} />}
          <MessageList data={data} fresh={fresh} tied={tied} onConfirm={(id) => decide(id, "confirm")} onReject={(id) => decide(id, "reject")} />
        </aside>
        <section className="flex min-w-0 flex-[999_1_640px] flex-col gap-3">
          {published && <PublishedPanel published={published} />}
          <h2 className="on-cork m-0 font-display text-xl font-extrabold">The rota</h2>
          <RotaGrid data={data} onOpen={setOpen} highlight={open} />
          <UncoveredPanels data={data} onOpen={setOpen} />
        </section>
        <RedStrings container={boardRef} links={links} version={`${coverage.covered}-${data.constraints.length}`} />
      </div>

      {open && <WhyDrawer data={data} shiftId={open} onClose={() => setOpen(null)} />}
      <Footer demo={data.workspace.isDemo} />
    </div>
  );
}

function needWord(role: string) {
  return role === "keyholder" ? "a key holder" : role === "kitchen" ? "kitchen staff" : `a ${role}`;
}

function LoadFailure({ failure }: { failure: ApiFailure }) {
  const title = failure.status === 401 ? "This session has ended" : failure.status === 404 ? "This rota isn't here" : "Couldn't load the rota";
  const body =
    failure.status === 401
      ? "Demo workspaces last 24 hours. Start a fresh one; it takes a second."
      : failure.status === 404
        ? "It may belong to another account or have been deleted."
        : failure.message;
  return (
    <div className="cork flex min-h-screen items-center justify-center px-4">
      <div className="ruled flex max-w-[460px] flex-col gap-3 rounded-md px-6 py-6 shadow-[0_8px_18px_rgba(40,20,5,.4)]" role="alert">
        <h1 className="m-0 font-display text-2xl font-extrabold">{title}</h1>
        <p className="m-0 text-base">{body}</p>
        <div className="flex flex-wrap items-center gap-3">
          <TryDemoButton className="min-h-11 rounded-lg bg-ink px-4 py-2.5 text-base font-bold text-paper" label="Start a fresh demo" />
          <Link href="/login" className="text-base">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
