"use client";

import type { weekView } from "@/lib/server/week";

// Browser-side API helper. The session lives in an httpOnly cookie set by /api/demo or /api/auth/*.

type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export type WeekData = Jsonify<ReturnType<typeof weekView>>;
export type ConstraintData = WeekData["constraints"][number];
export type SolutionData = WeekData["solution"];
export type ShiftData = WeekData["shifts"][number];
export type StaffData = WeekData["staff"][number];
export type MessageData = WeekData["messages"][number];

export class ApiFailure extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiFailure(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiFailure(res.status, err?.message ?? `Request failed (${res.status}).`, err?.code, err?.details);
  }
  return data as T;
}
