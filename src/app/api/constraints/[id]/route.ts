import { route, json, body, requireManager } from "@/lib/server/http";
import { ConstraintPatch, patchConstraint } from "@/lib/server/constraints";

export const PATCH = route<{ id: string }>(async ({ req, db, principal, params }) => {
  const { userId } = requireManager(principal);
  return json(await patchConstraint(db, userId, params.id, await body(req, ConstraintPatch)));
});
