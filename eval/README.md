# Extraction held-out eval

`extraction-heldout.json` is a 30-case held-out set for the message-to-constraints step (the AI proposes constraints; code resolves them into the rota week). Cases cover six paste formats (WhatsApp iOS, Android and Web in both dd/mm and US mm/dd, Telegram Desktop, LINE export, plain text), two-constraint messages, speaking for a colleague, shift names, preferences, corrections, caps, vague messages, no-constraint messages, explicit dates and past/other-week references.

**Written blind, on 2026-10-18.** The author had `docs/DOMAIN.md` and the product brief only, and did not read anything under `src/`. Expected values come from the domain semantics, not from what the implementation does. Do not tune prompts against these cases and then report the score as held-out.

Rota week: Mon 19 Oct to Sun 25 Oct 2026 (Europe/London). Messages were sent Wed 14 to Sun 18 Oct 2026.

## Scoring

A case passes when:

1. the set of proposed constraints matches `expected` exactly on `person`, `kind`, `dateFrom`, `dateTo`, `timeFrom`, `timeTo`, `daily`, `shiftLabel` and `value` (order-insensitive; no missing and no extra constraints), and
2. an "ask" is raised if and only if `expectAsk` is true.

Score = passing cases / 30. Report the failing ids with the diff.

## Conventions used for expected values

- `author` is the sender label exactly as it appears in the paste (or, for a bare plain paste, the only place the sender is given). `person` is the full staff name.
- Whole-day: `timeFrom` and `timeTo` null. "after 4" is `timeFrom` "16:00"; "till 11" or "before 12" is `timeTo` set.
- Consecutive days are one entry (`dateFrom`..`dateTo`); non-consecutive days are separate entries.
- A time window repeated over consecutive days is one entry with `daily` true. A label across the week ("closes", "opens") is one entry, 2026-10-19..2026-10-25, `daily` false.
- Caps (`max_shifts`, `max_hours`) have null dates and a numeric `value`.
- Vague messages: `expected` is `[]` and `expectAsk` is true. No-constraint, past-reference and other-week messages: `expected` is `[]` and `expectAsk` is false.
- Offering to take a shift ("I can do the night bake fri if that helps") is `prefer`. `available` is only for reversing an earlier refusal ("actually I can do ... now").
