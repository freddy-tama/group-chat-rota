import { OPENAPI } from "@/lib/server/openapi";

export const dynamic = "force-static";

export function GET() {
  return Response.json(OPENAPI);
}
