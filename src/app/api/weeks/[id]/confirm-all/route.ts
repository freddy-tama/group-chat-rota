import { z } from "zod";
import { route, json, body, requireManager } from "@/lib/server/http";
import { confirmAll } from "@/lib/server/constraints";

// "Confirm all (quotes shown)": confirms every complete proposed constraint, or only the ids given.
export const POST = route<{ id: string }>(async ({ req, db, principal, params }) => {
  const { userId } = requireManager(principal);
  const input = await body(req, z.object({ ids: z.array(z.string()).max(200).optional() }));
  return json(await confirmAll(db, userId, params.id, input.ids));
});
