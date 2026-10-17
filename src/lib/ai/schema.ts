import { z } from "zod";

// What the model must return for one chat message. The model proposes; code resolves the dates,
// checks the quote against the message, and the manager confirms.

export const PROMPT_VERSION = "x1";

export const CONSTRAINT_KINDS = ["unavailable", "available", "prefer", "prefer_not", "max_shifts", "max_hours"] as const;
export const WEEKDAY_TOKENS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const ModelConstraint = z.object({
  person: z.string(),
  kind: z.enum(CONSTRAINT_KINDS),
  days: z.array(z.enum(WEEKDAY_TOKENS)),
  dates: z.array(z.string()),
  allWeek: z.boolean(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  shift: z.string().nullable(),
  value: z.number().nullable(),
  quote: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});
export type ModelConstraint = z.infer<typeof ModelConstraint>;

export const ModelOutput = z.object({
  constraints: z.array(ModelConstraint),
  ask: z.object({ reason: z.string(), question: z.string() }).nullable(),
});
export type ModelOutput = z.infer<typeof ModelOutput>;

const nullable = (type: string) => ({ type: [type, "null"] });

/** Strict JSON schema sent to the model (structured outputs). Mirrors ModelOutput. */
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["constraints", "ask"],
  properties: {
    constraints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["person", "kind", "days", "dates", "allWeek", "from", "to", "shift", "value", "quote", "confidence"],
        properties: {
          person: { type: "string", description: "Who the constraint is about, as written. Usually the author." },
          kind: { type: "string", enum: [...CONSTRAINT_KINDS] },
          days: { type: "array", items: { type: "string", enum: [...WEEKDAY_TOKENS] } },
          dates: { type: "array", items: { type: "string" }, description: "Explicit dates exactly as written, e.g. \"24/10\"." },
          allWeek: { type: "boolean" },
          from: { ...nullable("string"), description: "24 h HH:MM start of the window on each day, or null." },
          to: { ...nullable("string"), description: "24 h HH:MM end of the window on each day, or null." },
          shift: { ...nullable("string"), description: "A shift label from the list, or null." },
          value: { ...nullable("number"), description: "Number for max_shifts / max_hours, else null." },
          quote: { type: "string", description: "The exact words from the message that say this. Copy, never paraphrase." },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    ask: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["reason", "question"],
          properties: {
            reason: { type: "string", description: "Why the message is too vague to turn into a constraint." },
            question: { type: "string", description: "A short, friendly reply the manager can post in the group chat." },
          },
        },
      ],
    },
  },
} as const;
