import { route, json, requireManager } from "@/lib/server/http";
import { publishWeek, publishedView } from "@/lib/server/publish";

const base = (req: Request) => new URL(req.url).origin;

// Locks the rota, creates one read-only link per staff member and drafts the group-chat reply.
export const POST = route<{ id: string }>(async ({ req, db, principal, params }) => {
  const { userId } = requireManager(principal);
  return json(await publishWeek(db, userId, params.id, base(req)), 201);
});

export const GET = route<{ id: string }>(async ({ req, db, principal, params }) => {
  const { userId } = requireManager(principal);
  return json(await publishedView(db, userId, params.id, base(req)));
});
