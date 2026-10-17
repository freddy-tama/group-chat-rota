import { route, json, requireManager } from "@/lib/server/http";
import { decide } from "@/lib/server/constraints";

export const POST = route<{ id: string }>(async ({ db, principal, params }) => {
  const { userId } = requireManager(principal);
  return json(await decide(db, userId, params.id, "rejected"));
});
