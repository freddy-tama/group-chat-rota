import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { CORNER_CAFE } from "@/lib/demo/corner-cafe";

// Seeds a fresh Corner Café workspace (synthetic demo data from docs/DOMAIN.md) for one owner.
// Every Try-demo session and every test run gets its own copy, so nobody's clicks collide.

/** The seed's confirmed constraints in stored (local) terms, keyed to the chat message they came from. */
export const SEED_CONSTRAINTS: {
  message: number; // 1-based line in the seeded chat
  staff: string;
  kind: string;
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
  daily?: boolean;
  shiftLabel?: string;
  value?: number;
  quote: string;
}[] = [
  { message: 2, staff: "st_ana", kind: "unavailable", dateFrom: "2026-10-24", dateTo: "2026-10-24", quote: "sat off pls" },
  { message: 4, staff: "st_sam", kind: "unavailable", dateFrom: "2026-10-20", dateTo: "2026-10-20", timeFrom: "16:00", quote: "can't do tues after 4" },
  { message: 4, staff: "st_sam", kind: "unavailable", dateFrom: "2026-10-24", dateTo: "2026-10-24", quote: "need sat off" },
  { message: 5, staff: "st_dara", kind: "unavailable", dateFrom: "2026-10-24", dateTo: "2026-10-24", shiftLabel: "Close", quote: "no sat close for me sorry" },
  { message: 7, staff: "st_mei", kind: "prefer", dateFrom: "2026-10-22", dateTo: "2026-10-23", shiftLabel: "Kitchen", quote: "I can do kitchen thurs + fri" },
  { message: 7, staff: "st_mei", kind: "unavailable", dateFrom: "2026-10-25", dateTo: "2026-10-25", quote: "not sun (church)" },
  { message: 8, staff: "st_tom", kind: "unavailable", dateFrom: "2026-10-19", dateTo: "2026-10-21", quote: "away mon-wed" },
  { message: 9, staff: "st_jo", kind: "max_shifts", value: 2, quote: "max 2 shifts please" },
  { message: 10, staff: "st_kofi", kind: "prefer", dateFrom: "2026-10-19", dateTo: "2026-10-25", timeTo: "12:00", daily: true, quote: "can do any mornings" },
  { message: 10, staff: "st_kofi", kind: "unavailable", dateFrom: "2026-10-19", dateTo: "2026-10-25", shiftLabel: "Close", quote: "no closes" },
  { message: 11, staff: "st_sam", kind: "unavailable", dateFrom: "2026-10-23", dateTo: "2026-10-23", timeTo: "11:00", quote: "fri morning dentist till 11" },
  { message: 12, staff: "st_kofi", kind: "prefer", dateFrom: "2026-10-24", dateTo: "2026-10-24", shiftLabel: "Mid", quote: "sat mid fine" },
  { message: 13, staff: "st_tom", kind: "prefer", dateFrom: "2026-10-24", dateTo: "2026-10-24", shiftLabel: "Kitchen", quote: "can do sat kitchen + sun brunch" },
  { message: 13, staff: "st_tom", kind: "prefer", dateFrom: "2026-10-25", dateTo: "2026-10-25", shiftLabel: "Brunch", quote: "can do sat kitchen + sun brunch" },
  { message: 14, staff: "st_ana", kind: "unavailable", dateFrom: "2026-10-25", dateTo: "2026-10-25", shiftLabel: "Close", quote: "can't do sun close" },
];

export async function seedCornerCafe(db: Db, ownerId: string, opts: { isDemo: boolean; name?: string }) {
  const seed = CORNER_CAFE;
  const workspaceId = randomUUID();
  const weekId = randomUUID();
  const now = new Date();
  const staffIds = new Map(seed.staff.map((s) => [s.id, randomUUID()]));
  const shiftIds = new Map(seed.shifts.map((s) => [s.id, randomUUID()]));
  const batchId = randomUUID();
  const messageIds = seed.messages.map(() => randomUUID());

  await db.transaction(async (tx) => {
    await tx.insert(t.workspaces).values({
      id: workspaceId, ownerId, name: opts.name ?? seed.workspaceName, timezone: seed.timezone, managerName: seed.managerName,
      dateOrder: "dmy", isDemo: opts.isDemo, expiresAt: opts.isDemo ? new Date(now.getTime() + 24 * 3600 * 1000) : null,
    });
    await tx.insert(t.staff).values(seed.staff.map((s) => ({
      id: staffIds.get(s.id)!, workspaceId, key: s.id, name: s.name, aliases: s.aliases, roles: s.roles, maxHours: s.maxHours,
      maxShifts: s.maxShifts ?? null, hourlyRate: s.hourlyRate ?? null,
    })));
    await tx.insert(t.rulePacks).values(seed.rulePacks.map((p) => ({
      id: randomUUID(), workspaceId, name: p.name, version: p.version, effectiveFrom: p.effectiveFrom, minRestHours: p.minRestHours,
      maxHoursDefault: p.maxHoursDefault, maxShiftsPerDay: p.maxShiftsPerDay,
      source: p.minRestHours >= 11 ? "11 h daily rest, as in the EU Working Time Directive (2003/88/EC, art. 3)" : "Earlier house rules",
    })));
    await tx.insert(t.weeks).values({ id: weekId, workspaceId, weekStart: seed.weekStart, status: "draft" });
    await tx.insert(t.shifts).values(seed.shifts.map((s) => ({
      id: shiftIds.get(s.id)!, weekId, key: s.id, label: s.label, role: s.role, localDate: s.localDate, startLocal: s.startLocal, endLocal: s.endLocal,
    })));
    await tx.insert(t.pins).values(seed.pins.map((p) => ({
      id: randomUUID(), weekId, shiftId: shiftIds.get(p.shiftId)!, staffId: staffIds.get(p.staffId)!, reason: p.reason,
    })));
    await tx.insert(t.messages).values(seed.messages.map((m, i) => {
      const staff = seed.staff.find((s) => s.name.split(" ")[0].toLowerCase() === m.author.toLowerCase());
      return {
        id: messageIds[i], weekId, batchId, seq: i + 1, author: m.author, staffId: staff ? staffIds.get(staff.id)! : null, text: m.text,
        sentAt: new Date(m.sentAt), timestampBasis: "parsed", sourceApp: "whatsapp-ios",
      };
    }));
    await tx.insert(t.constraints).values(SEED_CONSTRAINTS.map((c, i) => ({
      id: randomUUID(), weekId, messageId: messageIds[c.message - 1], staffId: staffIds.get(c.staff)!, kind: c.kind,
      dateFrom: c.dateFrom ?? null, dateTo: c.dateTo ?? null, timeFrom: c.timeFrom ?? null, timeTo: c.timeTo ?? null, daily: c.daily ?? false,
      shiftLabel: c.shiftLabel ?? null, value: c.value ?? null, quote: c.quote, status: "confirmed", origin: "seed", confidence: "high",
      checks: [], createdAt: new Date(now.getTime() + i), decidedAt: now,
    })));
    await tx.insert(t.fairnessHistory).values(seed.history.map((h) => ({
      id: randomUUID(), workspaceId, staffId: staffIds.get(h.staffId)!, weeks: h.weeks, closes: h.closes, weekends: h.weekends, nights: h.nights,
    })));
  });
  return { workspaceId, weekId };
}
