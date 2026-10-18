import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

// A hard cap on live AI spend, however many people use the demo at once. Before a paste calls
// the model, it reserves each call's worst-case cost under a row lock; afterwards it settles to
// the cost the provider actually reported. Reservations never take the total past the cap.

const TOTAL = "total";

function usdFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** All-time cap (AI_BUDGET_USD, default $30) and per-UTC-day cap (AI_DAILY_BUDGET_USD, default $5). */
export function budgetLimits() {
  return { totalUsd: usdFromEnv("AI_BUDGET_USD", 30), dailyUsd: usdFromEnv("AI_DAILY_BUDGET_USD", 5) };
}

const micros = (usd: number) => Math.ceil(usd * 1_000_000);
const today = () => new Date().toISOString().slice(0, 10);

export interface Reservation {
  day: string;
  granted: number; // how many of the requested calls may run, in order
  reservedMicros: number;
  stoppedBy: "total" | "day" | null; // which cap refused the rest
}

/** Reserves as many of `worstCostsUsd` (in order) as both caps allow. */
export async function reserveBudget(db: Db, worstCostsUsd: number[]): Promise<Reservation> {
  const day = today();
  if (worstCostsUsd.length === 0) return { day, granted: 0, reservedMicros: 0, stoppedBy: null };
  const limits = budgetLimits();
  return db.transaction(async (tx) => {
    await tx.insert(t.aiBudget).values([{ bucket: TOTAL }, { bucket: day }]).onConflictDoNothing();
    const rows = await tx.select().from(t.aiBudget).where(inArray(t.aiBudget.bucket, [TOTAL, day])).for("update");
    const spent = (bucket: string) => rows.find((r) => r.bucket === bucket)?.costMicros ?? 0;
    const totalLeft = micros(limits.totalUsd) - spent(TOTAL);
    const dayLeft = micros(limits.dailyUsd) - spent(day);
    const room = Math.min(totalLeft, dayLeft);
    let granted = 0;
    let reserved = 0;
    for (const cost of worstCostsUsd) {
      const m = micros(cost);
      if (reserved + m > room) break;
      reserved += m;
      granted++;
    }
    if (granted > 0) {
      await tx.update(t.aiBudget)
        .set({ costMicros: sql`${t.aiBudget.costMicros} + ${reserved}`, liveCalls: sql`${t.aiBudget.liveCalls} + ${granted}` })
        .where(inArray(t.aiBudget.bucket, [TOTAL, day]));
    }
    const stoppedBy = granted < worstCostsUsd.length ? (totalLeft <= dayLeft ? "total" : "day") : null;
    return { day, granted, reservedMicros: reserved, stoppedBy };
  });
}

/** Replaces a reservation with what the calls really cost. */
export async function settleBudget(db: Db, r: Reservation, actualUsd: number): Promise<void> {
  if (r.granted === 0) return;
  const delta = micros(actualUsd) - r.reservedMicros;
  if (delta === 0) return;
  await db.update(t.aiBudget)
    .set({ costMicros: sql`${t.aiBudget.costMicros} + ${delta}` })
    .where(inArray(t.aiBudget.bucket, [TOTAL, r.day]));
}

export async function budgetStatus(db: Db) {
  const limits = budgetLimits();
  const day = today();
  const rows = await db.select().from(t.aiBudget).where(inArray(t.aiBudget.bucket, [TOTAL, day]));
  const usd = (bucket: string) => (rows.find((r) => r.bucket === bucket)?.costMicros ?? 0) / 1_000_000;
  return { spentUsd: usd(TOTAL), limitUsd: limits.totalUsd, todayUsd: usd(day), dailyLimitUsd: limits.dailyUsd };
}
