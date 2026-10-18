// Runs the held-out extraction eval (eval/extraction-heldout.json) against a running app and
// grades it with the rules in eval/README.md. Each case gets a fresh demo workspace.
//
//   node scripts/eval.mjs https://group-chat-rota.vercel.app            grade only
//   node scripts/eval.mjs https://group-chat-rota.vercel.app --record   also save live model
//                                                                      answers as replay fixtures
//
// With --record it also records the messages the PRD journeys paste, so previews replay them.
// Replays always win over live calls, so a second run reproduces the first exactly.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.argv[2] ?? "").replace(/\/$/, "");
const record = process.argv.includes("--record");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/eval.mjs <base-url> [--record]");
  process.exit(1);
}

// Messages the PRD journeys paste (docs/PRD.md). Recorded, not graded.
const JOURNEY_PASTES = [
  "[18/10/2026, 21:30:02] Ana: actually I can do sat close now",
  "[18/10/2026, 22:10:15] Dara: might be busy weekend idk",
  "10/18/26, 9:30 PM - Ana: actually I can do sat close now",
  "Jo: can't do mon either",
];

const FIELDS = ["person", "kind", "dateFrom", "dateTo", "timeFrom", "timeTo", "daily", "shiftLabel", "value"];

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function runPaste(text) {
  const demo = await api("/api/demo", { method: "POST" });
  const week = await api(`/api/weeks/${demo.weekId}`, { token: demo.token });
  const names = new Map(week.staff.map((s) => [s.id, s.name]));
  const r = await api(`/api/weeks/${demo.weekId}/messages`, { method: "POST", token: demo.token, body: { text, consent: true } });
  return { r, names };
}

const tuple = (c) => JSON.stringify(FIELDS.map((f) => c[f] ?? null));

const fixturesPath = join(root, "src/lib/ai/fixtures.json");
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8"));
const recordedAt = new Date().toISOString();
let recorded = 0;
const models = new Set();

function keep(r) {
  for (const m of r.messages) {
    if (m.ai.model) models.add(m.ai.model);
    if (record && m.ai.source === "live" && m.ai.output) {
      fixtures[m.ai.key] = { model: m.ai.model, recordedAt, output: m.ai.output };
      recorded++;
    }
  }
  // Saved after every paste, so a failure part-way keeps what was already paid for.
  if (record) writeFileSync(fixturesPath, JSON.stringify(fixtures, null, 2) + "\n");
}

// The app needs a sender on each line. A bare-text case names its sender only in "author",
// so it is sent as "Author: text"; this tests the AI step, not the paste reader.
const SENDER_LINE = /^(\[[^\]]+\]\s*)?[^:\n]{1,40}:\s/;
const withSender = (c) => (c.app === "plain" && !SENDER_LINE.test(c.paste) ? `${c.author}: ${c.paste}` : c.paste);

const startBudget = (await api("/api/health")).aiBudget;

if (record) {
  for (const text of JOURNEY_PASTES) {
    const { r } = await runPaste(text);
    keep(r);
    console.log(`journey  ${r.messages.map((m) => m.ai.source).join(",")}  ${text}`);
  }
}

const cases = JSON.parse(readFileSync(join(root, "eval/extraction-heldout.json"), "utf8"));
const results = [];
const prefixed = [];
for (const c of cases) {
  const text = withSender(c);
  if (text !== c.paste) prefixed.push(c.id);
  let run;
  try {
    run = await runPaste(text);
  } catch (err) {
    const error = String(err?.message ?? err);
    results.push({ id: c.id, app: c.app, pass: false, missing: c.expected.map(tuple), extra: [], expectAsk: c.expectAsk, gotAsk: false, askReasons: [], sources: [], format: null, error });
    console.log(`FAIL ${c.id} ${c.app.padEnd(17)} error: ${error}`);
    continue;
  }
  const { r, names } = run;
  keep(r);
  const rows = r.constraints;
  const got = rows.filter((x) => x.status !== "ask").map((x) => ({ ...x, person: x.staffId ? names.get(x.staffId) ?? null : null }));
  const asks = rows.filter((x) => x.status === "ask");
  const want = c.expected.map(tuple).sort();
  const have = got.map(tuple).sort();
  const missing = want.filter((w) => !have.includes(w));
  const extra = have.filter((h) => !want.includes(h));
  const askOk = asks.length > 0 === c.expectAsk;
  const pass = missing.length === 0 && extra.length === 0 && askOk;
  results.push({
    id: c.id, app: c.app, pass, missing, extra, expectAsk: c.expectAsk, gotAsk: asks.length > 0,
    askReasons: asks.map((a) => a.askReason), sources: r.messages.map((m) => m.ai.source), format: r.format.app,
  });
  console.log(`${pass ? "PASS" : "FAIL"} ${c.id} ${c.app.padEnd(17)} ${r.messages.map((m) => m.ai.source).join(",")}`);
}

const endBudget = (await api("/api/health")).aiBudget;
const passed = results.filter((x) => x.pass).length;
const live = results.filter((x) => x.sources.includes("live")).length;
const replay = results.filter((x) => x.sources.length > 0 && x.sources.every((s) => s === "replay")).length;
writeFileSync(join(root, "eval/results.json"), JSON.stringify({ base, ranAt: recordedAt, model: [...models], promptVersion: "x1", passed, total: results.length, results }, null, 2) + "\n");

const fmt = (t) => {
  const v = JSON.parse(t);
  return `${v[0]} · ${v[1]} · ${v[2] ?? "–"}..${v[3] ?? "–"}${v[4] || v[5] ? ` ${v[4] ?? ""}–${v[5] ?? ""}` : ""}${v[6] ? " daily" : ""}${v[7] ? ` · ${v[7]}` : ""}${v[8] != null ? ` · ${v[8]}` : ""}`;
};
const lines = [
  "# Extraction eval: results",
  "",
  `**${passed}/${results.length} cases pass** (${Math.round((passed / results.length) * 100)}%), graded by \`scripts/eval.mjs\` with the rules in [README.md](README.md).`,
  "",
  `- Model: ${[...models].join(", ") || "none"} · prompt version \`x1\` (unchanged since before the set was written; not tuned on it).`,
  `- Run: ${recordedAt.slice(0, 16).replace("T", " ")} UTC against ${base}. ${live} cases called the model live, ${replay} replayed recorded answers.`,
  `- Live spend for this run: $${(endBudget.spentUsd - startBudget.spentUsd).toFixed(4)}.`,
  "- Rerun: `node scripts/eval.mjs <url>`. Recorded answers replay first, so a rerun reproduces these numbers.",
  ...(prefixed.length
    ? [`- ${prefixed.join(" and ")} are bare text whose sender is given only in the case's \`author\` field. The app needs a name on each line (a bare paste gets "No chat messages found"), so these were sent as \`Author: text\`.`]
    : []),
  "",
  "## Misses",
  "",
];
const fails = results.filter((x) => !x.pass);
if (fails.length === 0) lines.push("None.");
for (const f of fails) {
  lines.push(`### ${f.id} (${f.app})`, "");
  for (const m of f.missing) lines.push(`- Missing: ${fmt(m)}`);
  for (const e of f.extra) lines.push(`- Extra: ${fmt(e)}`);
  if (f.error) lines.push(`- Error: ${f.error}`);
  if (f.expectAsk !== f.gotAsk) lines.push(`- Ask: expected ${f.expectAsk ? "an ask" : "no ask"}, got ${f.gotAsk ? `an ask (${f.askReasons.join("; ")})` : "none"}`);
  lines.push("");
}
lines.push("## All cases", "", "| Case | Format | Result |", "|---|---|---|");
for (const r of results) lines.push(`| ${r.id} | ${r.app} | ${r.pass ? "pass" : "**fail**"} |`);
writeFileSync(join(root, "eval/RESULTS.md"), lines.join("\n") + "\n");

console.log(`\n${passed}/${results.length} pass · recorded ${recorded} answers · spent $${(endBudget.spentUsd - startBudget.spentUsd).toFixed(4)}`);
