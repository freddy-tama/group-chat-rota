import { route, json, requireManager, ApiError } from "@/lib/server/http";
import { loadWeek, solveBundle } from "@/lib/server/week";

// Re-solves the week from confirmed constraints only. Proposed and Ask items are ignored.
export const POST = route<{ id: string }>(async ({ db, principal, params }) => {
  const { userId } = requireManager(principal);
  const bundle = await loadWeek(db, userId, params.id);
  if (bundle.week.status === "published") throw new ApiError(409, "published", "This week is published. Its rota is locked.");
  return json(solveBundle(bundle));
});
