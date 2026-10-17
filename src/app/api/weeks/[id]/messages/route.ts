import { route, json, body, requireManager } from "@/lib/server/http";
import { PasteBody, ingestPaste } from "@/lib/server/ingest";

// Paste chat messages. Each becomes proposed constraints (with quotes and checks) or an Ask item.
// Nothing reaches the solver until the manager confirms it.
export const POST = route<{ id: string }>(async ({ req, db, principal, params }) => {
  const { userId } = requireManager(principal);
  const input = await body(req, PasteBody);
  return json(await ingestPaste(db, userId, params.id, input), 201);
});

export const maxDuration = 60;
