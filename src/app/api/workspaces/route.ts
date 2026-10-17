import { z } from "zod";
import { route, json, body, requireManager } from "@/lib/server/http";
import { me } from "@/lib/server/accounts";
import { seedCornerCafe } from "@/lib/server/seed";

export const GET = route(async ({ db, principal }) => {
  const { userId } = requireManager(principal);
  return json({ workspaces: (await me(db, userId)).workspaces });
});

const CreateWorkspace = z.object({
  name: z.string().trim().min(1, "Give the workspace a name.").max(80),
  template: z.enum(["corner-cafe"]).default("corner-cafe"),
});

// New workspaces start from the sample café (staff, shift pattern and rule pack you then edit).
export const POST = route(async ({ req, db, principal }) => {
  const { userId, isDemo } = requireManager(principal);
  const input = await body(req, CreateWorkspace);
  const { workspaceId, weekId } = await seedCornerCafe(db, userId, { isDemo, name: input.name });
  return json({ workspace: { id: workspaceId, name: input.name }, weekId }, 201);
});
