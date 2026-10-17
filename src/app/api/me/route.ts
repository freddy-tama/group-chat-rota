import { route, json, requireManager } from "@/lib/server/http";
import { me } from "@/lib/server/accounts";

export const GET = route(async ({ db, principal }) => {
  const { userId } = requireManager(principal);
  return json(await me(db, userId));
});
