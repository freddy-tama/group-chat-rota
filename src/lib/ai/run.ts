import fixtures from "./fixtures.json";
import { ModelOutput, MODEL_OUTPUT_JSON_SCHEMA, PROMPT_VERSION } from "./schema";
import { SYSTEM_PROMPT, buildUserPrompt, fixtureKey, type ExtractContext, type ExtractMessage } from "./extract";

// Runs the model for one message. Replay fixtures always win, so previews and tests are
// deterministic; production (AI_MODE=live) calls the model only for messages it has never seen.

export type AiSource = "replay" | "live" | "none";

export interface AiResult {
  key: string;
  source: AiSource;
  model: string | null;
  output: ModelOutput | null;
  error: string | null;
  latencyMs: number;
}

interface Fixture {
  model: string;
  recordedAt: string;
  output: unknown;
}

const FIXTURES = fixtures as Record<string, Fixture>;

export function aiMode(): "replay" | "live" {
  return process.env.AI_MODE === "live" ? "live" : "replay";
}

export type AiProvider = "anthropic" | "openrouter";

const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: "claude-haiku-5-5",
  openrouter: "deepseek/deepseek-v4-flash",
};

/** AI_PROVIDER picks one explicitly; otherwise whichever key is set, Anthropic first. */
export function aiProvider(): AiProvider | null {
  const forced = process.env.AI_PROVIDER;
  if (forced === "anthropic" || forced === "openrouter") return keyFor(forced) ? forced : null;
  if (keyFor("anthropic")) return "anthropic";
  if (keyFor("openrouter")) return "openrouter";
  return null;
}

function keyFor(provider: AiProvider): string | undefined {
  return provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENROUTER_API_KEY;
}

export function aiModel(provider: AiProvider | null = aiProvider()): string | null {
  if (!provider) return null;
  return process.env.AI_MODEL || DEFAULT_MODEL[provider];
}

export function lookupFixture(key: string): Fixture | null {
  return FIXTURES[key] ?? null;
}

class CallFailed extends Error {}

const TOOL_NAME = "record_constraints";

/** One model call. Returns the parsed JSON answer and the model that produced it. */
async function callModel(provider: AiProvider, model: string, ctx: ExtractContext, msg: ExtractMessage): Promise<{ json: unknown; model: string }> {
  const user = buildUserPrompt(ctx, msg);
  const signal = AbortSignal.timeout(25_000);
  if (provider === "anthropic") {
    // Claude: a forced tool call carries the structured answer; zod checks it below.
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: user }],
        tools: [{ name: TOOL_NAME, description: "Record the constraints found in the message, or what to ask.", input_schema: MODEL_OUTPUT_JSON_SCHEMA }],
        tool_choice: { type: "tool", name: TOOL_NAME },
      }),
    });
    if (!res.ok) throw new CallFailed(await failure(provider, res));
    const body = (await res.json()) as { model?: string; content?: { type: string; name?: string; input?: unknown }[] };
    const call = body.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
    if (!call) throw new CallFailed("The model didn't return an answer");
    return { json: call.input, model: body.model ?? model };
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/freddy-tama/group-chat-rota",
      "X-Title": "Group Chat Rota",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: `chat_constraints_${PROMPT_VERSION}`, strict: true, schema: MODEL_OUTPUT_JSON_SCHEMA } },
    }),
  });
  if (!res.ok) throw new CallFailed(await failure(provider, res));
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; model?: string };
  const content = body.choices?.[0]?.message?.content ?? "";
  return { json: JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")), model: body.model ?? model };
}

/** Logs the provider's reason server-side; the manager sees only the status. */
async function failure(provider: AiProvider, res: Response): Promise<string> {
  const detail = await res.text().catch(() => "");
  console.error(`[ai] ${provider} ${res.status}: ${detail.slice(0, 300)}`);
  return `Model call failed (${res.status})`;
}

export async function runExtraction(ctx: ExtractContext, msg: ExtractMessage, opts: { allowLive: boolean }): Promise<AiResult> {
  const key = fixtureKey(msg);
  const started = Date.now();
  const fixture = lookupFixture(key);
  if (fixture) {
    const parsed = ModelOutput.safeParse(fixture.output);
    return {
      key, source: "replay", model: fixture.model, output: parsed.success ? parsed.data : null,
      error: parsed.success ? null : "Replay fixture does not match the schema", latencyMs: Date.now() - started,
    };
  }
  const provider = aiProvider();
  if (aiMode() !== "live" || !opts.allowLive || !provider) {
    const why = aiMode() !== "live"
      ? "AI is in replay mode here and has no recording for this message."
      : !provider ? "No AI key is configured." : "This workspace has used its AI quota for the hour.";
    return { key, source: "none", model: null, output: null, error: why, latencyMs: 0 };
  }

  const model = aiModel(provider)!;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answer = await callModel(provider, model, ctx, msg);
      const parsed = ModelOutput.safeParse(answer.json);
      if (!parsed.success) {
        lastError = "The model's answer did not match the schema";
        continue;
      }
      return { key, source: "live", model: answer.model, output: parsed.data, error: null, latencyMs: Date.now() - started };
    } catch (err) {
      lastError = err instanceof CallFailed ? err.message
        : err instanceof Error && err.name === "TimeoutError" ? "The model took too long"
        : "The model's answer was not valid JSON";
    }
  }
  return { key, source: "none", model, output: null, error: lastError, latencyMs: Date.now() - started };
}

/** Run several messages with a small concurrency limit, preserving order. */
export async function runAll<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
