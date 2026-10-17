import { z } from "zod";
import { route, json, body } from "@/lib/server/http";
import { parseOnly } from "@/lib/server/ingest";

// Stateless: shows how a paste is read (app, date order, timestamps) before any AI runs.
export const POST = route(async ({ req }) => {
  const input = await body(req, z.object({
    text: z.string().min(1, "Paste some messages.").max(20_000),
    timezone: z.string().default("Europe/London"),
    dateOrder: z.enum(["dmy", "mdy"]).optional(),
  }));
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: input.timezone });
  } catch {
    return json({ error: { code: "validation_failed", message: "Unknown time zone." } }, 422);
  }
  return json(parseOnly(input.text, input.timezone, input.dateOrder));
});
