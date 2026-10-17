import { z } from "zod";
import { getDb, type Db } from "@/lib/db/client";
import { principalFrom, type Principal } from "@/lib/auth";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new ApiError(404, "not_found", what);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: status === 204 ? headers : { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler: gives it the database and the caller, and turns errors into JSON. */
export function route<P = Record<string, string>>(
  fn: (args: { req: Request; db: Db; principal: Principal | null; params: P }) => Promise<Response>,
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const db = await getDb();
      const principal = await principalFrom(db, req);
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await fn({ req, db, principal, params });
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, err.status);
      }
      console.error(err);
      return json({ error: { code: "internal", message: "Something went wrong on our side." } }, 500);
    }
  };
}

/** The caller must be a signed-in manager (a user session); staff share links get 403. */
export function requireManager(principal: Principal | null): { userId: string; isDemo: boolean } {
  if (!principal) throw new ApiError(401, "unauthenticated", "Sign in or start a demo first.");
  if (principal.kind !== "user") throw new ApiError(403, "forbidden", "Staff links are read-only.");
  return { userId: principal.userId, isDemo: principal.isDemo };
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(422, "invalid_json", "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, "validation_failed", "Some fields are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return parsed.data;
}
