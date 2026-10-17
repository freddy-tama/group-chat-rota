"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/client/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await api<{ workspaceId: string | null; weekId?: string }>(`/api/auth/${mode}`, { body: { email, password } });
      if (res.weekId) return router.push(`/week/${res.weekId}`);
      const me = await api<{ workspaces: { currentWeekId: string | null }[] }>("/api/me");
      const week = me.workspaces.find((w) => w.currentWeekId)?.currentWeekId;
      router.push(week ? `/week/${week}` : "/");
    } catch (err) {
      if (err instanceof ApiFailure && err.details) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      }
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const title = mode === "login" ? "Sign in" : "Create your account";
  return (
    <div className="cork flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} noValidate className="ruled flex w-full max-w-[420px] flex-col gap-4 rounded-md px-6 py-6 shadow-[0_8px_18px_rgba(40,20,5,.4)]">
        <h1 className="m-0 font-display text-3xl font-extrabold">{title}</h1>
        {mode === "register" && <p className="m-0 text-[15px] text-ink-soft">Your account starts with a copy of the sample café, ready to edit.</p>}
        <label className="flex flex-col gap-1 text-[15px] font-bold">
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email} className="min-h-11 rounded-md border-[1.5px] border-[#8a7a66] bg-white px-3 text-base font-normal" />
          {fieldErrors.email && <span className="text-sm font-normal text-problem">{fieldErrors.email}</span>}
        </label>
        <label className="flex flex-col gap-1 text-[15px] font-bold">
          Password
          <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} value={password}
            onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fieldErrors.password}
            className="min-h-11 rounded-md border-[1.5px] border-[#8a7a66] bg-white px-3 text-base font-normal" />
          {fieldErrors.password ? <span className="text-sm font-normal text-problem">{fieldErrors.password}</span>
            : mode === "register" && <span className="text-sm font-normal text-muted">At least 8 characters.</span>}
        </label>
        {error && !Object.keys(fieldErrors).length && <p role="alert" className="m-0 text-[15px] text-problem">{error}</p>}
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-ink px-4 py-2.5 text-base font-bold text-paper disabled:opacity-70">
          {busy ? "One moment…" : title}
        </button>
        <p className="m-0 text-[15px]">
          {mode === "login" ? <>New here? <Link href="/register">Create an account</Link> or <Link href="/">try the demo</Link>.</>
            : <>Already have an account? <Link href="/login">Sign in</Link>.</>}
        </p>
      </form>
    </div>
  );
}
