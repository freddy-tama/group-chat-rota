"use client";

import { useId, useState } from "react";
import type { ConstraintData, WeekData } from "@/lib/client/api";
import { sentLabel } from "@/lib/client/describe";
import { Chip } from "./Chip";
import { ConstraintEditor } from "./ConstraintEditor";

export interface PasteOutcome {
  app: string;
  dateOrder: { value: string; basis: string };
  clock: string;
  messages: number;
  skipped: number;
  redacted: number;
  warnings: string[];
  aiMode: string;
}

const APP_NAME: Record<string, string> = {
  "whatsapp-ios": "WhatsApp (iPhone)",
  "whatsapp-android": "WhatsApp (Android export)",
  "whatsapp-web": "WhatsApp Web",
  telegram: "Telegram",
  line: "LINE",
  plain: "plain “Name: text” lines",
};

const ORDER_NAME: Record<string, string> = { dmy: "day/month", mdy: "month/day", ymd: "year/month/day" };

export const SAMPLE_PASTE = "[18/10/2026, 21:30:02] Ana: actually I can do sat close now";

export function PasteBox({ onPaste, disabled }: { onPaste: (text: string) => Promise<PasteOutcome>; disabled?: boolean }) {
  const id = useId();
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PasteOutcome | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return setError("Paste at least one message first.");
    if (!consent) return setError("Tick the box to confirm your team agreed first.");
    setBusy(true);
    setError(null);
    try {
      const result = await onPaste(text);
      setOutcome(result);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read those messages. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 rounded-md bg-paper px-4 py-3.5 shadow-[0_4px_12px_rgba(40,20,5,.3)]" data-testid="paste-box">
      <label htmlFor={`${id}-text`} className="font-display text-lg font-extrabold">Paste from the group chat</label>
      <textarea
        id={`${id}-text`}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled || busy}
        placeholder={SAMPLE_PASTE}
        className="resize-y rounded-md border-[1.5px] border-[#8a7a66] bg-white p-2.5 text-[15px]"
      />
      <div className="flex items-start gap-2 text-[13px] text-ink-soft">
        <input id={`${id}-consent`} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={disabled || busy} className="mt-0.5 h-[18px] w-[18px] shrink-0" />
        <label htmlFor={`${id}-consent`}>
          My team agreed to have these messages read by an AI model. Phone numbers, emails and links are masked before it sees them; names stay as labels.
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="submit" disabled={disabled || busy} className="min-h-11 rounded-lg bg-ink px-4 text-[15px] font-bold text-paper disabled:opacity-60">
          {busy ? "Reading messages…" : "Read messages"}
        </button>
        <button type="button" onClick={() => setText(SAMPLE_PASTE)} disabled={disabled || busy} className="min-h-11 px-1 text-[14px] text-confirmed underline">
          Use a sample message
        </button>
      </div>
      <p className="m-0 text-[13px] text-muted">WhatsApp, Telegram or LINE copies, or plain &ldquo;Name: text&rdquo; lines.</p>
      {error && <p role="alert" className="m-0 text-[15px] font-bold text-problem">{error}</p>}
      {outcome && (
        <p role="status" data-testid="paste-outcome" className="m-0 rounded-md bg-confirmed-bg px-3 py-2 text-[14px] text-[#163a6b]">
          Read as {APP_NAME[outcome.app] ?? outcome.app} · dates {ORDER_NAME[outcome.dateOrder.value] ?? outcome.dateOrder.value}
          {outcome.dateOrder.basis === "detected" ? " (detected)" : outcome.dateOrder.basis === "assumed" ? " (assumed)" : ""} · {outcome.messages}{" "}
          {outcome.messages === 1 ? "message" : "messages"}
          {outcome.skipped > 0 && ` · ${outcome.skipped} skipped`}
          {outcome.redacted > 0 && ` · ${outcome.redacted} masked`}
          {outcome.warnings.map((w) => <span key={w} className="block">{w}</span>)}
        </p>
      )}
    </form>
  );
}

/** For a confirmed unavailability, the quote of a later confirmed "available" from the same person that carves into it. */
function overrides(data: WeekData): Map<string, string> {
  const sentOf = new Map(data.messages.map((m) => [m.id, m.sentAt ?? ""]));
  const out = new Map<string, string>();
  const confirmed = data.constraints.filter((c) => c.status === "confirmed");
  for (const a of confirmed.filter((c) => c.kind === "available")) {
    for (const u of confirmed.filter((c) => c.kind === "unavailable" && c.staffId === a.staffId)) {
      const later = (sentOf.get(a.messageId ?? "") ?? "") > (sentOf.get(u.messageId ?? "") ?? "");
      const overlap = (a.dateFrom ?? "") <= (u.dateTo ?? u.dateFrom ?? "") && (u.dateFrom ?? "") <= (a.dateTo ?? a.dateFrom ?? "");
      if (later && overlap) out.set(u.id, a.quote);
    }
  }
  return out;
}

export function MessageList({
  data,
  fresh,
  onConfirm,
  onReject,
  onEdited,
  tied,
}: {
  data: WeekData;
  fresh: Set<string>;
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onEdited: (id: string, confirmNow: boolean) => Promise<void>;
  tied: Set<string>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const byMessage = new Map<string, ConstraintData[]>();
  for (const c of data.constraints) {
    if (!c.messageId) continue;
    byMessage.set(c.messageId, [...(byMessage.get(c.messageId) ?? []), c]);
  }
  const over = overrides(data);
  const readOnly = data.week.status === "published";
  const first = data.messages[0]?.sentAt;
  const last = data.messages[data.messages.length - 1]?.sentAt;

  if (data.messages.length === 0) {
    return <p className="on-cork m-0 text-[15px]">No messages yet. Paste this week&rsquo;s chat above to start.</p>;
  }
  return (
    <div className="flex flex-col gap-3.5" data-testid="message-list">
      <h2 className="on-cork m-0 mt-1.5 font-display text-xl font-extrabold">
        Staff chat{first && last ? ` · ${sentLabel(first, data.workspace.timezone).split(" · ")[0]} to ${sentLabel(last, data.workspace.timezone).split(" · ")[0]}` : ""}
      </h2>
      {data.messages.map((m) => {
        const chips = byMessage.get(m.id) ?? [];
        const isManager = m.author.toLowerCase() === data.workspace.managerName.toLowerCase();
        return (
          <article
            key={m.id}
            data-message-id={m.id}
            data-testid="chat-message"
            tabIndex={-1}
            className={`flex flex-col gap-1.5 rounded bg-paper px-3 pt-2.5 pb-3 shadow-[0_3px_8px_rgba(40,20,5,.3)] ${tied.has(m.id) ? "outline-[3px] outline-string outline-solid" : ""}`}
          >
            <div className="flex justify-between gap-2 text-[13px] text-muted">
              <span className="font-bold text-ink">{m.author}{isManager ? " (manager)" : ""}</span>
              <span>{sentLabel(m.sentAt, data.workspace.timezone)}{m.timestampBasis === "assumed" ? " (assumed)" : ""}</span>
            </div>
            <div className="text-base leading-snug whitespace-pre-line">{m.text}</div>
            {chips.map((c) =>
              editing === c.id ? (
                <ConstraintEditor key={c.id} data={data} c={c} onCancel={() => setEditing(null)}
                  onSaved={async (confirmNow) => { await onEdited(c.id, confirmNow); setEditing(null); }} />
              ) : (
                <Chip key={c.id} c={c} weekStart={data.week.weekStart} fresh={fresh.has(c.id)} readOnly={readOnly}
                  overriddenBy={over.get(c.id) ?? null} onConfirm={onConfirm} onReject={onReject} onEdit={readOnly ? undefined : setEditing} />
              ),
            )}
            {chips.length === 0 && !isManager && <span className="text-[13px] text-muted">No constraint in this one.</span>}
          </article>
        );
      })}
    </div>
  );
}
