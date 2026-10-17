"use client";

import { useState } from "react";
import type { ConstraintData } from "@/lib/client/api";
import { describeConstraint } from "@/lib/client/describe";

export function Chip({
  c,
  weekStart,
  fresh,
  readOnly,
  overriddenBy,
  onConfirm,
  onReject,
}: {
  c: ConstraintData;
  weekStart: string;
  fresh?: boolean;
  readOnly?: boolean;
  overriddenBy?: string | null;
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | "confirm" | "reject">(null);
  const what = describeConstraint(c, weekStart);
  const anim = fresh ? " chip-in" : "";

  async function act(kind: "confirm" | "reject") {
    setBusy(kind);
    try {
      await (kind === "confirm" ? onConfirm(c.id) : onReject(c.id));
    } finally {
      setBusy(null);
    }
  }

  if (c.status === "confirmed") {
    return (
      <div data-testid="chip" data-status="confirmed" className={`flex flex-wrap items-center gap-1.5 rounded-md border-[1.5px] border-confirmed bg-confirmed-bg px-2 py-1.5 text-[13px] text-[#163a6b]${anim}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5L19 7" /></svg>
        <span className="font-bold">{what}</span>
        <span>&ldquo;{c.quote}&rdquo;</span>
        <span className="sr-only">Confirmed.</span>
        {overriddenBy && <span className="w-full text-[12px] text-ink-soft">Partly overridden by a later message: &ldquo;{overriddenBy}&rdquo;</span>}
      </div>
    );
  }

  if (c.status === "rejected") {
    return (
      <div data-testid="chip" data-status="rejected" className="flex flex-wrap items-center gap-1.5 rounded-md border border-edge px-2 py-1 text-[13px] text-muted">
        <span className="line-through">{what} &ldquo;{c.quote}&rdquo;</span>
        <span>Rejected</span>
      </div>
    );
  }

  if (c.status === "ask") {
    return (
      <div data-testid="chip" data-status="ask" className={`flex flex-col gap-2 rounded-lg border-2 border-ask bg-ask-bg px-3 py-2.5${anim}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-ask px-1.5 py-0.5 text-[12px] font-bold text-white">ASK</span>
          <span className="text-[15px]">{c.askReason ?? "Needs your answer before it can count."}</span>
        </div>
        {c.draftReply && <DraftReply text={c.draftReply} />}
        <span className="text-[13px] text-muted">Doesn&rsquo;t change the rota until it becomes a confirmed constraint.</span>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => act("reject")} disabled={!!busy} className="min-h-11 rounded-lg px-2.5 text-[15px] text-muted underline">
              {busy === "reject" ? "Dismissing…" : "Dismiss"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // proposed
  return (
    <div data-testid="chip" data-status="proposed" className={`flex flex-col gap-2 rounded-lg border-2 border-dashed border-proposed bg-proposed-bg px-3 py-2.5${anim}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-proposed px-1.5 py-0.5 text-[12px] font-bold text-paper">PROPOSED</span>
        <span className="text-base font-bold">{what}</span>
        <span className="text-[15px]">&ldquo;{c.quote}&rdquo;</span>
      </div>
      {c.checks.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1 p-0 text-[13px] text-ink-soft" aria-label="Checks on this proposal">
          {c.checks.map((k, i) => (
            <li key={i} className={k.ok ? "" : "font-bold text-problem"}>{k.ok ? "✓" : "✗"} {k.detail}</li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => act("confirm")} disabled={!!busy} className="min-h-11 rounded-lg bg-confirmed px-3.5 text-[15px] font-bold text-white disabled:opacity-70">
            {busy === "confirm" ? "Confirming…" : "Confirm"}
          </button>
          <button type="button" onClick={() => act("reject")} disabled={!!busy} className="min-h-11 rounded-lg px-2.5 text-[15px] text-muted">
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
        </div>
      )}
    </div>
  );
}

function DraftReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 rounded-md border border-[#d8c9ea] bg-white px-2.5 py-2 text-[15px]">{text}</p>
      <button
        type="button"
        className="min-h-11 self-start rounded-lg bg-ask px-3.5 text-[15px] font-bold text-white"
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
        {copied ? "Copied" : "Copy reply"}
      </button>
    </div>
  );
}
