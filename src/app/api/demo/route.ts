import { route, json } from "@/lib/server/http";
import { startDemo } from "@/lib/server/accounts";
import { sessionCookie } from "@/lib/auth";

// Try demo: no sign-up. Each call gets its own freshly seeded Corner Café workspace.
export const POST = route(async ({ db }) => {
  const result = await startDemo(db);
  return json(result, 201, { "set-cookie": sessionCookie(result.token) });
});
