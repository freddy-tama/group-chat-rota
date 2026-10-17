import { route, json, requireManager } from "@/lib/server/http";
import { decide } from "@/lib/server/constraints";

// Only a confirmed constraint reaches the solver. Staff share links get 403.
export const POST = route<{ id: string }>(async ({ db, principal, params }) => {
  const { userId } = requireManager(principal);
  return json(await decide(db, userId, params.id, "confirmed"));
});
