// The live model call, with fetch stubbed: which provider runs, what it is sent, and how its
// answer is read. No network and no credits.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiModel, aiProvider, runExtraction } from "@/lib/ai/run";
import type { ExtractContext, ExtractMessage } from "@/lib/ai/extract";

const ctx: ExtractContext = {
  timezone: "Europe/London",
  weekStart: "2026-10-19",
  managerName: "Lou",
  dateOrder: "dmy",
  staff: [{ id: "st_ana", name: "Ana Costa", aliases: ["Ana"] }],
  shifts: [{ label: "Close", localDate: "2026-10-24", startLocal: "14:00", endLocal: "22:00" }],
};
// Not in fixtures.json, so it always reaches the provider.
const msg: ExtractMessage = { author: "Ana", localDate: "2026-10-18", localTime: "21:30", text: "test-only: can do sat close now", context: [] };

const answer = {
  constraints: [{
    person: "Ana", kind: "available", days: ["sat"], dates: [], allWeek: false,
    from: null, to: null, shift: "Close", value: null, quote: "can do sat close now", confidence: "high",
  }],
  ask: null,
};

const ENV_KEYS = ["AI_MODE", "AI_PROVIDER", "AI_MODEL", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.AI_MODE = "live";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function stubFetch(reply: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply(url, init);
  }));
  return calls;
}

describe("choosing the provider", () => {
  it("no key: no provider, and a paste becomes an Ask item without calling out", async () => {
    const calls = stubFetch(() => new Response("{}"));
    expect(aiProvider()).toBeNull();
    const r = await runExtraction(ctx, msg, { allowLive: true });
    expect(r).toMatchObject({ source: "none", error: "No AI key is configured." });
    expect(calls).toHaveLength(0);
  });

  it("prefers Anthropic when both keys are set; AI_PROVIDER forces the other", () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    expect(aiProvider()).toBe("anthropic");
    expect(aiModel()).toBe("claude-haiku-5-5");
    process.env.AI_PROVIDER = "openrouter";
    expect(aiProvider()).toBe("openrouter");
    expect(aiModel()).toBe("deepseek/deepseek-v4-flash");
    process.env.AI_MODEL = "some/other-model";
    expect(aiModel()).toBe("some/other-model");
  });

  it("a forced provider without its key counts as no key", () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.AI_PROVIDER = "anthropic";
    expect(aiProvider()).toBeNull();
  });
});

describe("calling Anthropic", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
  });

  it("forces the record_constraints tool and reads its input", async () => {
    const calls = stubFetch(() => Response.json({
      model: "claude-haiku-5-5",
      content: [{ type: "tool_use", id: "tu_1", name: "record_constraints", input: answer }],
    }));
    const r = await runExtraction(ctx, msg, { allowLive: true });
    expect(r).toMatchObject({ source: "live", model: "claude-haiku-5-5", error: null });
    expect(r.output?.constraints[0]).toMatchObject({ kind: "available", shift: "Close", quote: "can do sat close now" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-anthropic");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: "claude-haiku-5-5", tool_choice: { type: "tool", name: "record_constraints" } });
    expect(body).not.toHaveProperty("temperature"); // the live API rejects it for Haiku 5.5 (400)
    expect(body.tools[0].input_schema.required).toEqual(["constraints", "ask"]);
    expect(body.messages[0].content).toContain("test-only: can do sat close now");
  });

  it("retries once, then reports the status; an answer off the schema is never used", async () => {
    let n = 0;
    stubFetch(() => (++n === 1
      ? new Response("overloaded", { status: 529 })
      : Response.json({ content: [{ type: "tool_use", name: "record_constraints", input: { constraints: "nope" } }] })));
    const r = await runExtraction(ctx, msg, { allowLive: true });
    expect(n).toBe(2);
    expect(r).toMatchObject({ source: "none", output: null, error: "The model's answer did not match the schema" });

    stubFetch(() => new Response("bad key", { status: 401 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runExtraction(ctx, msg, { allowLive: true })).toMatchObject({ source: "none", error: "Model call failed (401)" });
  });
});

describe("calling OpenRouter", () => {
  it("asks for strict JSON and reads the message content", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    const calls = stubFetch(() => Response.json({
      model: "deepseek/deepseek-v4-flash",
      choices: [{ message: { content: JSON.stringify(answer) } }],
    }));
    const r = await runExtraction(ctx, msg, { allowLive: true });
    expect(r).toMatchObject({ source: "live", model: "deepseek/deepseek-v4-flash" });
    expect(r.output?.constraints).toHaveLength(1);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer test-openrouter");
    expect(JSON.parse(String(calls[0].init.body)).response_format.json_schema.strict).toBe(true);
  });
});
