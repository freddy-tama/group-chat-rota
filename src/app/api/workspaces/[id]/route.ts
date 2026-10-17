import { eq } from "drizzle-orm";
import { route, json, requireManager } from "@/lib/server/http";
import { loadWorkspace } from "@/lib/server/week";
import * as t from "@/lib/db/schema";

export const GET = route<{ id: string }>(async ({ db, principal, params }) => {
  const { userId } = requireManager(principal);
  const ws = await loadWorkspace(db, userId, params.id);
  const weeks = await db.select({ id: t.weeks.id, weekStart: t.weeks.weekStart, status: t.weeks.status }).from(t.weeks).where(eq(t.weeks.workspaceId, ws.id));
  return json({ workspace: { id: ws.id, name: ws.name, timezone: ws.timezone, managerName: ws.managerName, isDemo: ws.isDemo }, weeks });
});

// Deletes the workspace and everything in it (staff, weeks, messages, constraints, share links).
export const DELETE = route<{ id: string }>(async ({ db, principal, params }) => {
  const { userId } = requireManager(principal);
  const ws = await loadWorkspace(db, userId, params.id);
  await db.delete(t.workspaces).where(eq(t.workspaces.id, ws.id));
  return json(null, 204);
});
