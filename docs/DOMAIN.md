# Domain spec: Corner Café demo week, rules and solver semantics

This is the source of truth for the seeded demo, the solver, the checker and the test suite.
Where code and this file disagree, fix one of them in the same PR and say which.

## The demo workspace

- **Workspace:** Corner Café, time zone `Europe/London`, manager **Lou**.
- **Rota week:** Mon 19 Oct to Sun 25 Oct 2026. UK clocks go back on **Sun 25 Oct 2026 at 02:00 BST → 01:00 GMT**, so Sunday is 25 h long.
- **Rule pack:** House rules **v3**, effective from Mon 19 Oct 2026: minimum rest **11 h** between two shifts of the same person, weekly hours cap **40 h** unless the staff record is lower, at most **1 shift per day** (a shift belongs to the day it starts). House rules **v2** (effective 1 Sep 2026) had 10 h rest; it no longer applies to this week.
- **Synthetic data.** Every name and message is invented for the demo.

### Staff (9)

| id | Name | Chat aliases | Roles | Max hours |
|---|---|---|---|---|
| st_ana | Ana Costa | ana | keyholder, barista | 40 |
| st_ben | Ben Okafor | ben | keyholder, barista | 40 |
| st_dara | Dara Kim | dara | keyholder, barista | 40 |
| st_sam | Sam Lee | sam, sammy | keyholder, barista | 24 |
| st_priya | Priya Nair | priya | baker | 30 |
| st_kofi | Kofi Mensah | kofi | barista | 32 |
| st_mei | Mei Tanaka | mei | kitchen, barista | 32 |
| st_tom | Tom Byrne | tom | kitchen | 40 |
| st_jo | Jo Silva | jo | barista | 20 |

### Shifts (22)

Each shift needs exactly one person with its role. Opens and closes need a **key holder**.

| id | Day | Label | Local time | Role | Hours |
|---|---|---|---|---|---|
| sh_01 | Mon 19 | Open | 07:00–15:00 | keyholder | 8 |
| sh_02 | Mon 19 | Close | 14:00–22:00 | keyholder | 8 |
| sh_03 | Tue 20 | Open | 07:00–15:00 | keyholder | 8 |
| sh_04 | Tue 20 | Close | 14:00–22:00 | keyholder | 8 |
| sh_05 | Wed 21 | Open | 07:00–15:00 | keyholder | 8 |
| sh_06 | Wed 21 | Close | 14:00–22:00 | keyholder | 8 |
| sh_07 | Wed 21 | Night bake | 22:00–06:00 | baker | 8 |
| sh_08 | Thu 22 | Open | 07:00–15:00 | keyholder | 8 |
| sh_09 | Thu 22 | Kitchen | 11:00–17:00 | kitchen | 6 |
| sh_10 | Thu 22 | Close | 14:00–22:00 | keyholder | 8 |
| sh_11 | Fri 23 | Open | 07:00–15:00 | keyholder | 8 |
| sh_12 | Fri 23 | Kitchen | 11:00–17:00 | kitchen | 6 |
| sh_13 | Fri 23 | Close | 14:00–22:00 | keyholder | 8 |
| sh_14 | Fri 23 | Night bake | 22:00–06:00 | baker | 8 |
| sh_15 | Sat 24 | Open | 07:00–15:00 | keyholder | 8 |
| sh_16 | Sat 24 | Kitchen | 10:00–16:00 | kitchen | 6 |
| sh_17 | Sat 24 | Mid | 10:00–18:00 | barista | 8 |
| sh_18 | Sat 24 | Close | 14:00–22:00 | keyholder | 8 |
| sh_19 | Sat 24 | Night bake | 22:00–06:00 | baker | **9** (clocks go back) |
| sh_20 | Sun 25 | Open | 08:00–16:00 | keyholder | 8 |
| sh_21 | Sun 25 | Brunch | 09:00–15:00 | kitchen | 6 |
| sh_22 | Sun 25 | Close | 12:00–18:00 | keyholder | 6 |

**Pins (manager-locked):** Ben Okafor works every weekday close (sh_02, sh_04, sh_06, sh_10, sh_13): "Contract: weekday closes". That is 5 × 8 h = **40.0 h**, his cap.

### The group chat (seed, WhatsApp iOS copy format)

```
[14/10/2026, 08:30:12] Lou: Rota for w/c 19 Oct goes up Sunday night. Tell me what you can't do 🙏
[14/10/2026, 09:12:40] Ana: sat off pls 🙏
[14/10/2026, 09:40:03] Ben: usual for me 👍
[14/10/2026, 12:03:55] Sam: can't do tues after 4, also need sat off
[14/10/2026, 18:22:10] Dara: no sat close for me sorry, gig that night 🎸
[15/10/2026, 07:55:31] Priya: bakes as normal 👍
[15/10/2026, 10:31:18] Mei: I can do kitchen thurs + fri, not sun (church)
[15/10/2026, 13:47:02] Tom: away mon-wed, back thurs
[16/10/2026, 08:15:44] Jo: exams next week so max 2 shifts please
[16/10/2026, 16:20:09] Kofi: can do any mornings, no closes
[17/10/2026, 09:10:27] Sam: oh and fri morning dentist till 11
[17/10/2026, 14:30:51] Kofi: sat mid fine 👍
[18/10/2026, 10:05:36] Tom: can do sat kitchen + sun brunch
[18/10/2026, 19:40:14] Ana: sorry also can't do sun close, family dinner
```

### Confirmed constraints the chat yields

Weekday names resolve **forward into the rota week** ("sat" in a Wed 14 Oct message means Sat 24 Oct, not Sat 17 Oct).

| From | Person | Kind | Applies to | Quote |
|---|---|---|---|---|
| Ana 14 Oct | Ana | unavailable | all of Sat 24 | "sat off pls" |
| Sam 14 Oct | Sam | unavailable | Tue 20 from 16:00 | "can't do tues after 4" |
| Sam 14 Oct | Sam | unavailable | all of Sat 24 | "need sat off" |
| Dara 14 Oct | Dara | unavailable | Sat 24, Close only | "no sat close for me sorry" |
| Mei 15 Oct | Mei | unavailable | all of Sun 25 | "not sun (church)" |
| Mei 15 Oct | Mei | prefer | Thu 22 and Fri 23 Kitchen | "I can do kitchen thurs + fri" |
| Tom 15 Oct | Tom | unavailable | all of Mon 19 to Wed 21 | "away mon-wed" |
| Jo 16 Oct | Jo | max_shifts | 2 | "max 2 shifts please" |
| Kofi 16 Oct | Kofi | unavailable | every Close | "no closes" |
| Kofi 16 Oct | Kofi | prefer | mornings (shifts starting before 12:00) | "can do any mornings" |
| Sam 17 Oct | Sam | unavailable | Fri 23 until 11:00 | "fri morning dentist till 11" |
| Kofi 17 Oct | Kofi | prefer | Sat 24 Mid | "sat mid fine" |
| Tom 18 Oct | Tom | prefer | Sat 24 Kitchen, Sun 25 Brunch | "can do sat kitchen + sun brunch" |
| Ana 18 Oct | Ana | unavailable | Sun 25, Close only | "can't do sun close" |

Lou, Ben and Priya's messages carry no constraint.

### What the demo must show (structural facts; true for every optimal rota)

- **21 of 22 shifts covered.** Sat 24 Oct Close (sh_18) is the only uncovered shift. It needs a key holder, and every key holder is blocked:
  - Ana: unavailable all day Sat 24 ("sat off pls");
  - Ben: at max 40.0 h (pinned weekday closes);
  - Dara: unavailable for Sat Close ("no sat close for me sorry");
  - Sam: unavailable all day Sat 24 ("need sat off");
  - the other 5 staff are not key holders.
- **Sat 24 Oct Open (sh_15) is Dara's.** She is the only key holder free that morning.
- **Priya works all three night bakes** (only baker): 8 + 8 + 9 = **25.0 h**. The Sat 24 → Sun 25 bake is 9.0 h because the clocks go back.
- **Violations are always empty**, and nobody's rest gap is under 11 h.
- **Pasting "actually I can do sat close now" from Ana** and confirming it gives **22/22** with Ana on Sat Close. A later "available" constraint carves an exception out of an earlier "unavailable" one for the same person.
- **Unconfirmed (proposed) constraints change nothing.** Coverage stays 21/22 until the manager confirms.

Assignments among Ana, Dara and Sam for the weekday opens and Sunday shifts are tie-break choices. Tests must not assert them.

## Constraint semantics

- A constraint counts only when its status is `confirmed`. `proposed`, `ask` and `rejected` are ignored by the solver.
- **unavailable** with a window: a shift is blocked if its interval overlaps the window. With `shiftLabel`, only shifts with that label inside the window are blocked. A window may be a whole local day (00:00 to next 00:00, so 23 h or 25 h on clock-change days).
- **available**: carves an exception out of the same person's **earlier** (by message time) unavailability, for shifts inside its window (and label, if given). It never overrides a later unavailability.
- **prefer / prefer_not**: soft. They only break ties after coverage.
- **max_shifts / max_hours**: hard caps for the week; the effective cap is the minimum of the staff record, the rule pack and any confirmed constraint.

## Solver contract

Pure, synchronous, deterministic TypeScript. Same input → byte-identical output, regardless of the order of input arrays (sort by id internally). No time limits: use a deterministic node budget so results never depend on machine speed.

Hard rules (a rota that breaks one is invalid), in the order blockers report them:
1. role: the person has the shift's role;
2. availability: no confirmed unavailability covers the shift (after available-exceptions);
3. no overlap between a person's shifts;
4. at most `maxShiftsPerDay` shifts per local start date;
5. rest: the gap between the end of one of a person's shifts and the start of their next is at least `minRestHours`, measured in real elapsed hours across days and clock changes;
6. weekly hours ≤ effective max hours; weekly shifts ≤ effective max shifts;
7. pins are kept (a pin that breaks a hard rule is reported as a violation, never silently dropped).

Objective, lexicographic:
1. maximise covered shifts;
2. maximise preference score (+1 per prefer matched, −1 per prefer_not matched);
3. minimise the fairness penalty: the spread of less-wanted shifts (closes, weekend shifts, night bakes), counting the last 3 weeks of history;
4. tie-break: shifts in chronological order (then id), candidates by staff id.

For every uncovered shift, return one blocker per staff member holding the role, with the first hard rule that stops them taking it in the final rota (in the order above; role is summarised as a count), the quote if a constraint is the reason, and their current hours if the cap is.

The **checker** (`verifyRota`) is separate code that recomputes every hard rule from the assignments alone. The API returns its result as `violations`. It must not import the solver's internals.
