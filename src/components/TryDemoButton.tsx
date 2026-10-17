"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

export function TryDemoButton({ className, label = "Try the demo café, no sign-up" }: { className?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { weekId } = await api<{ weekId: string }>("/api/demo", { method: "POST" });
      router.push(`/week/${weekId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the demo.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        data-testid="try-demo"
        className={className ?? "min-h-11 rounded-[10px] bg-paper px-6 py-3.5 text-lg font-bold text-ink shadow-[0_6px_14px_rgba(0,0,0,.3)] hover:bg-white disabled:opacity-70"}
      >
        {busy ? "Setting up your café…" : label}
      </button>
      {error && <p role="alert" className="m-0 rounded bg-paper px-3 py-2 text-sm text-problem">{error}</p>}
    </div>
  );
}
