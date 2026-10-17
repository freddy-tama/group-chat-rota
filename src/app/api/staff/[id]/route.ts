import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { route, json, body, requireManager, notFound } from "@/lib/server/http";
import * as t from "@/lib/db/schema";

const StaffPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  maxHours: z.number().min(0, "Hours can't be negative.").max(80, "At most 80 hours a week.").optional(),
  maxShifts: z.number().int().min(0).max(14).nullable().optional(),
  roles: z.array(z.enum(["keyholder", "barista", "kitchen", "baker"])).min(1).optional(),
});

export const PATCH = route<{ id: string }>(async ({ req, db, principal, params }) => {
  const { userId } = requireManager(principal);
  const patch = await body(req, StaffPatch);
  const [row] = await db
    .select({ id: t.staff.id })
    .from(t.staff)
    .innerJoin(t.workspaces, eq(t.workspaces.id, t.staff.workspaceId))
    .where(and(eq(t.staff.id, params.id), eq(t.workspaces.ownerId, userId)));
  if (!row) throw notFound("No such staff member.");
  const [updated] = await db.update(t.staff).set(patch).where(eq(t.staff.id, row.id)).returning();
  return json({ staff: { id: updated.id, key: updated.key, name: updated.name, roles: updated.roles, maxHours: updated.maxHours, maxShifts: updated.maxShifts } });
});
