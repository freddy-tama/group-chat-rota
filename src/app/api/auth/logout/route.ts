import { route, json } from "@/lib/server/http";
import { clearedSessionCookie } from "@/lib/auth";

export const POST = route(async () => json(null, 204, { "set-cookie": clearedSessionCookie() }));
