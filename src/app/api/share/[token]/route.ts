import { route, json } from "@/lib/server/http";
import { shareView } from "@/lib/server/publish";

// Public, read-only: one staff member's own shifts in a published week. Unknown tokens are 404.
export const GET = route<{ token: string }>(async ({ db, params }) => json(await shareView(db, params.token)));
