# Extraction eval: results

**26/30 cases pass** (87%), graded by `scripts/eval.mjs` with the rules in [README.md](README.md).

- Model: claude-haiku-5-5 · prompt version `x1` (unchanged since before the set was written; not tuned on it).
- Run: 2026-10-18 12:06 UTC against https://group-chat-rota.vercel.app. 30 cases called the model live, 0 replayed recorded answers.
- Live spend for this run: $0.0105.
- Rerun: `node scripts/eval.mjs <url>`. Recorded answers replay first, so timestamped cases reproduce exactly. A paste with no timestamp (the plain cases) is stamped with the time it is pasted, which is part of its recording key, so those cases call the model again.
- h28 and h30 are bare text whose sender is given only in the case's `author` field. The app needs a name on each line (a bare paste gets "No chat messages found"), so these were sent as `Author: text`.

## Misses

### h03 (whatsapp-ios)

- Missing: Mei Tanaka · unavailable · 2026-10-19..2026-10-22 19:00– daily
- Extra: Mei Tanaka · unavailable · 2026-10-19..2026-10-22 19:00–22:00 daily

### h16 (whatsapp-web)

- Ask: expected no ask, got an ask (Ben's message refers to 'last sat', which is before the rota week (Mon 19 Oct to Sun 25 Oct), so it does not affect next week's rota.)

### h23 (line)

- Missing: Jo Silva · unavailable · 2026-10-21..2026-10-21 –12:00
- Missing: Jo Silva · unavailable · 2026-10-23..2026-10-23 –12:00
- Extra: Jo Silva · unavailable · 2026-10-21..2026-10-21
- Extra: Jo Silva · unavailable · 2026-10-23..2026-10-23 00:00–12:00

### h30 (plain)

- Ask: expected no ask, got an ask (31/10 is Sat 31 Oct, outside the rota week)

## All cases

| Case | Format | Result |
|---|---|---|
| h01 | whatsapp-ios | pass |
| h02 | whatsapp-ios | pass |
| h03 | whatsapp-ios | **fail** |
| h04 | whatsapp-ios | pass |
| h05 | whatsapp-ios | pass |
| h06 | whatsapp-ios | pass |
| h07 | whatsapp-android | pass |
| h08 | whatsapp-android | pass |
| h09 | whatsapp-android | pass |
| h10 | whatsapp-android | pass |
| h11 | whatsapp-android | pass |
| h12 | whatsapp-android | pass |
| h13 | whatsapp-web | pass |
| h14 | whatsapp-web | pass |
| h15 | whatsapp-web | pass |
| h16 | whatsapp-web | **fail** |
| h17 | whatsapp-web | pass |
| h18 | telegram | pass |
| h19 | telegram | pass |
| h20 | telegram | pass |
| h21 | telegram | pass |
| h22 | telegram | pass |
| h23 | line | **fail** |
| h24 | line | pass |
| h25 | line | pass |
| h26 | line | pass |
| h27 | plain | pass |
| h28 | plain | pass |
| h29 | plain | pass |
| h30 | plain | **fail** |
