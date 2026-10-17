"use client";

import { useState } from "react";
import type { WeekData } from "@/lib/client/api";
import { describeConstraint } from "@/lib/client/describe";

/**
 * What still needs the manager: proposals to confirm (all at once, with every quote on show)
 * and Ask items the AI wouldn't guess at. Neither changes the rota until the manager acts.
 */
export function ReviewQueue({ data, onConfirmAll, onJump }: { data: WeekData; onConfirmAll: () => Promise<void>; onJump: (messageId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const staff = new Map(data.staff.map((s) => [s.id, s.name.split(" ")[0]]));
  const author = new Map(data.messages.map((m) => [m.id, m.author]));
  const proposed = data.constraints.filter((c) => c.status === "proposed");
  const asks = data.constraints.filter((c) => c.status === "ask");
  if (data.week.status === "published" || (proposed.length === 0 && asks.length === 0)) return null;

  return (
    <section className="flex flex-col gap-3 rounded-md bg-paper-warm px-4 py-3.5 shadow-[0_4px_12px_rgba(40,20,5,.3)]" data-testid="review-queue" aria-labelledby="review-title">
      <h2 id="review-title" className="m-0 font-display text-lg font-extrabold">Waiting for you</h2>
      {proposed.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="confirm-all-panel">
          <p className="m-0 text-[15px]">
            {proposed.length} {proposed.length === 1 ? "proposal" : "proposals"} from the AI. Check each quote, then confirm:
          </p>
          <ol className="m-0 flex flex-col gap-1.5 pl-5 text-[15px]">
            {proposed.map((c) => (
              <li key={c.id}>
                <strong>{c.staffId ? staff.get(c.staffId) : author.get(c.messageId ?? "") ?? "Someone"}</strong>: {describeConstraint(c, data.week.weekStart)}
                <span className="block text-[14px] text-ink-soft">&ldquo;{c.quote}&rdquo;</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirmAll();
              } finally {
                setBusy(false);
              }
            }}
            className="min-h-11 self-start rounded-lg bg-confirmed px-4 text-[15px] font-bold text-white disabled:opacity-70"
          >
            {busy ? "Confirming…" : proposed.length === 1 ? "Confirm it (quote shown above)" : `Confirm all ${proposed.length} (quotes shown above)`}
          </button>
        </div>
      )}
      {asks.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="ask-queue">
          <p className="m-0 text-[15px]">
            <span className="mr-1.5 rounded bg-ask px-1.5 py-0.5 text-[12px] font-bold text-white">ASK</span>
            {asks.length} {asks.length === 1 ? "message needs" : "messages need"} your answer before {asks.length === 1 ? "it counts" : "they count"}:
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {asks.map((c) => (
              <li key={c.id} className="flex flex-col">
                <button type="button" onClick={() => c.messageId && onJump(c.messageId)} className="min-h-11 self-start text-left text-[15px] text-confirmed underline">
                  {author.get(c.messageId ?? "") ?? "Message"}: &ldquo;{c.quote.length > 60 ? `${c.quote.slice(0, 57)}…` : c.quote}&rdquo;
                </button>
                {c.askReason && <span className="text-[14px] text-ink-soft">{c.askReason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
