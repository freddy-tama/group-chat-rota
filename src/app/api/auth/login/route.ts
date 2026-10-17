import { route, json, body } from "@/lib/server/http";
import { Credentials, login } from "@/lib/server/accounts";
import { sessionCookie } from "@/lib/auth";

export const POST = route(async ({ req, db }) => {
  const input = await body(req, Credentials);
  const result = await login(db, input);
  return json(result, 200, { "set-cookie": sessionCookie(result.token) });
});
