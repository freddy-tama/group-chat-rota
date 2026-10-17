import { route, json, body } from "@/lib/server/http";
import { Credentials, register } from "@/lib/server/accounts";
import { sessionCookie } from "@/lib/auth";

export const POST = route(async ({ req, db }) => {
  const input = await body(req, Credentials);
  const result = await register(db, input);
  return json(result, 201, { "set-cookie": sessionCookie(result.token) });
});
