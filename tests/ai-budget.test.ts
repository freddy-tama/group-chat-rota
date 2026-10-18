// The site-wide AI spend cap: reservations never pass it, settling records the real cost, and
// deleting workspaces doesn't reset it. Model calls are stubbed; nothing is spent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "@/lib/db/client";
import { budgetStatus, reserveBudget, settleBudget } from "@/lib/server/budget";
import { POST as demo } from "@/app/api/demo/route";
import { POST as paste } from "@/app/api/weeks/[id]/messages/route";
import { DELETE as deleteWorkspace } from "@/app/api/workspaces/[id]/route";
import { GET as health } from "@/app/api/health/route";

const ENV_KEYS = ["AI_MODE", "AI_PROVIDER", "AI_MODEL", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "AI_BUDGET_USD", "AI_DAILY_BUDGET_USD", "AI_PRICE_IN_PER_MTOK", "AI_PRICE_OUT_PER_MTOK"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("reserving and settling", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("grants calls in order until the total cap, then settles to the real cost", async () => {
    process.env.AI_BUDGET_USD = "0.01";
    const r = await reserveBudget(db, [0.004, 0.004, 0.004]);
    expect(r).toMatchObject({ granted: 2, reservedMicros: 8000, stoppedBy: "total" });
    expect((await budgetStatus(db)).spentUsd).toBeCloseTo(0.008, 9);

    await settleBudget(db, r, 0.001);
    expect(await budgetStatus(db)).toMatchObject({ spentUsd: 0.001, todayUsd: 0.001, limitUsd: 0.01 });

    expect((await reserveBudget(db, [0.004, 0.004, 0.004])).granted).toBe(2);
  });

  it("the daily cap stops first when it is the tighter one", async () => {
    process.env.AI_DAILY_BUDGET_USD = "0.005";
    expect(await reserveBudget(db, [0.004, 0.004])).toMatchObject({ granted: 1, stoppedBy: "day" });
  });

  it("many pastes at once never reserve past the cap", async () => {
    process.env.AI_BUDGET_USD = "0.01";
    const all = await Promise.all(Array.from({ length: 20 }, () => reserveBudget(db, [0.004])));
    expect(all.reduce((n, r) => n + r.granted, 0)).toBe(2);
    expect((await budgetStatus(db)).spentUsd).toBeLessThanOrEqual(0.01);
  });

  it("a cap of 0 grants nothing", async () => {
    process.env.AI_BUDGET_USD = "0";
    expect(await reserveBudget(db, [0.000001])).toMatchObject({ granted: 0, stoppedBy: "total" });
  });
});

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;
async function call<P>(h: Handler<P>, opts: { method?: string; token?: string; body?: unknown; params?: P } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await h(new Request("http://localhost/api/x", { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve((opts.params ?? {}) as P) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const THREE = [
  "[18/10/2026, 21:00:01] Ana: test-budget one, can do sat close",
  "[18/10/2026, 21:00:02] Ana: test-budget two, can do sat close",
  "[18/10/2026, 21:00:03] Ana: test-budget three, can do sat close",
].join("\n");

function stubClaude() {
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    calls++;
    return Response.json({
      model: "claude-haiku-5-5",
      usage: { input_tokens: 1000, output_tokens: 100 },
      content: [{ type: "tool_use", name: "record_constraints", input: {
        constraints: [{ person: "Ana", kind: "available", days: ["sat"], dates: [], allWeek: false, from: null, to: null, shift: "Close", value: null, quote: "can do sat close", confidence: "high" }],
        ask: null,
      } }],
    });
  }));
  return () => calls;
}

describe("the cap on the paste endpoint", () => {
  beforeEach(() => {
    process.env.AI_MODE = "live";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
  });

  it("records each message's real cost, and deleting the workspace doesn't refund it", async () => {
    const calls = stubClaude();
    const before = (await call(health)).body.aiBudget.spentUsd as number;
    const d = (await call(demo, { method: "POST" })).body;
    const r = await call(paste, { token: d.token, body: { text: THREE, consent: true }, params: { id: d.weekId } });
    expect(r.status).toBe(201);
    expect(calls()).toBe(3);
    expect(r.body.messages.map((m: { ai: { source: string } }) => m.ai.source)).toEqual(["live", "live", "live"]);
    // Haiku 5.5: 1,000 tokens in at $0.10/M plus 100 out at $0.50/M = $0.00015 a message.
    const after = (await call(health)).body.aiBudget;
    expect(after.spentUsd - before).toBeCloseTo(0.00045, 9);
    expect(after).toMatchObject({ limitUsd: 30, dailyLimitUsd: 5 });

    expect((await call(deleteWorkspace, { method: "DELETE", token: d.token, params: { id: d.workspaceId } })).status).toBe(204);
    expect((await call(health)).body.aiBudget.spentUsd).toBeCloseTo(after.spentUsd, 9);
  });

  it("once the budget is used up, messages become Ask items and the model isn't called", async () => {
    const calls = stubClaude();
    const spent = (await call(health)).body.aiBudget.spentUsd as number;
    process.env.AI_BUDGET_USD = String(spent);
    const d = (await call(demo, { method: "POST" })).body;
    const r = await call(paste, { token: d.token, body: { text: THREE, consent: true }, params: { id: d.weekId } });
    expect(r.status).toBe(201);
    expect(calls()).toBe(0);
    expect(r.body.constraints.map((c: { status: string }) => c.status)).toEqual(["ask", "ask", "ask"]);
    expect(r.body.constraints[0].askReason).toBe("The live demo has used its AI budget. Write this one yourself.");
  });
});
