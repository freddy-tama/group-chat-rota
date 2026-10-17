import { route, json, requireManager } from "@/lib/server/http";
import { explainBundle, loadWeek } from "@/lib/server/week";

// For one shift: who is on it, their rest either side, and why each other person can't (or wasn't) put there.
export const GET = route<{ id: string; shiftId: string }>(async ({ db, principal, params }) => {
  const { userId } = requireManager(principal);
  return json(explainBundle(await loadWeek(db, userId, params.id), params.shiftId));
});
