import { route, json } from "@/lib/server/http";
import { dbKind } from "@/lib/db/client";
import { aiMode, aiModel, aiProvider } from "@/lib/ai/run";
import { budgetStatus } from "@/lib/server/budget";

export const GET = route(async ({ db }) => {
  await db.execute("select 1");
  return json({
    ok: true,
    db: dbKind(),
    aiMode: aiMode(),
    aiProvider: aiProvider(),
    aiModel: aiModel(),
    aiBudget: await budgetStatus(db),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  });
});
