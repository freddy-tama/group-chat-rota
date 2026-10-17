"use client";

import { useEffect, useRef, useState } from "react";
import { api, type WeekData } from "@/lib/client/api";
import { dayLabel } from "@/lib/client/describe";

export interface Published {
  receipt: { line: string; covered: number; total: number; rulePack: string };
  shareLinks: { staffId: string; name: string; url: string }[];
  chatBack: string;
}

export function PublishButton({ data, onPublished }: { data: WeekData; onPublished: (p: Published) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const { covered, total } = data.solution.coverage;
  const waiting = data.counts.proposed + data.counts.ask;

  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      onPublished(await api<Published>(`/api/weeks/${data.week.id}/publish`, { method: "POST" }));
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setAsking(true)} className="min-h-11 rounded-lg bg-paper px-4 text-[15px] font-bold text-ink">
        Publish rota
      </button>
      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-4" onClick={() => !busy && setAsking(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="publish-title" onClick={(e) => e.stopPropagation()}
            className="ruled flex w-full max-w-[480px] flex-col gap-3 rounded-md px-6 py-5 text-ink shadow-[0_10px_30px_rgba(0,0,0,.45)]">
            <h2 id="publish-title" className="m-0 font-display text-2xl font-extrabold">Publish the week of {dayLabel(data.week.weekStart)}?</h2>
            <ul className="m-0 flex flex-col gap-1 pl-5 text-[15px]">
              <li>{covered}/{total} shifts covered{covered < total ? `; ${total - covered} still open` : ""}.</li>
              <li>The rota locks: no more pasting or confirming this week.</li>
              <li>Everyone gets a private, read-only link to their own shifts and hours.</li>
              <li>You get a reply to paste back into the group chat.</li>
            </ul>
            {waiting > 0 && (
              <p className="m-0 rounded-md bg-proposed-bg px-3 py-2 text-[15px] text-[#7a3d06]">
                {waiting} {waiting === 1 ? "item is" : "items are"} still waiting for you. They won&rsquo;t count once you publish.
              </p>
            )}
            {error && <p role="alert" className="m-0 text-problem">{error}</p>}
            <div className="flex flex-wrap gap-2.5">
              <button type="button" onClick={publish} disabled={busy} className="min-h-11 rounded-lg bg-ink px-4 text-[15px] font-bold text-paper disabled:opacity-70">
                {busy ? "Publishing…" : "Publish rota"}
              </button>
              <button ref={keepRef} type="button" onClick={() => setAsking(false)} disabled={busy} className="min-h-11 rounded-lg border-[1.5px] border-[#8a7a66] bg-paper px-4 text-[15px]">
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="min-h-11 rounded-lg bg-ink px-3.5 text-[15px] font-bold text-paper"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** After publishing: the reply for the group chat and one private link per person. */
export function PublishedPanel({ published }: { published: Published }) {
  return (
    <section className="ruled flex flex-col gap-3 rounded-md border-2 border-confirmed px-4 py-4 shadow-[0_6px_16px_rgba(40,20,5,.35)]" data-testid="published-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 font-display text-xl font-extrabold">Published. Paste this back into the group</h2>
        <CopyButton text={published.chatBack} label="Copy reply" />
      </div>
      <pre className="m-0 max-h-[320px] overflow-auto rounded-md bg-white px-3 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap" data-testid="chat-back" style={{ fontFamily: "inherit" }}>
        {published.chatBack}
      </pre>
      <h3 className="m-0 text-base font-bold">Private links</h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px]">
        {published.shareLinks.map((l) => (
          <li key={l.staffId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <strong className="min-w-[110px]">{l.name}</strong>
            <a href={l.url} target="_blank" rel="noreferrer" className="break-all" data-testid="share-link">
              Open {l.name.split(" ")[0]}&rsquo;s shifts
            </a>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[13px] text-muted">Receipt on every link: {published.receipt.line}.</p>
    </section>
  );
}
