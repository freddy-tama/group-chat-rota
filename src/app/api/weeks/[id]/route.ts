import { route, json, requireManager } from "@/lib/server/http";
import { loadWeek, weekView } from "@/lib/server/week";

export const GET = route<{ id: string }>(async ({ db, principal, params }) => {
  const { userId } = requireManager(principal);
  return json(weekView(await loadWeek(db, userId, params.id)));
});
