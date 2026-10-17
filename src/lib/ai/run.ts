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

export function aiModel(): string {
  return process.env.AI_MODEL || "deepseek/deepseek-v4-flash";
}

export function lookupFixture(key: string): Fixture | null {
  return FIXTURES[key] ?? null;
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
  if (aiMode() !== "live" || !opts.allowLive || !process.env.OPENROUTER_API_KEY) {
    const why = aiMode() !== "live"
      ? "AI is in replay mode here and has no recording for this message."
      : !process.env.OPENROUTER_API_KEY ? "No AI key is configured." : "This workspace has used its AI quota for the hour.";
    return { key, source: "none", model: null, output: null, error: why, latencyMs: 0 };
  }

  const model = aiModel();
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(25_000),
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
            { role: "user", content: buildUserPrompt(ctx, msg) },
          ],
          response_format: { type: "json_schema", json_schema: { name: `chat_constraints_${PROMPT_VERSION}`, strict: true, schema: MODEL_OUTPUT_JSON_SCHEMA } },
        }),
      });
      if (!res.ok) {
        lastError = `Model call failed (${res.status})`;
        continue;
      }
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; model?: string };
      const content = body.choices?.[0]?.message?.content ?? "";
      const json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      const parsed = ModelOutput.safeParse(json);
      if (!parsed.success) {
        lastError = "The model's answer did not match the schema";
        continue;
      }
      return { key, source: "live", model: body.model ?? model, output: parsed.data, error: null, latencyMs: Date.now() - started };
    } catch (err) {
      lastError = err instanceof Error && err.name === "TimeoutError" ? "The model took too long" : "The model's answer was not valid JSON";
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
