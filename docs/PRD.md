# Group Chat Rota: product requirements (for the test suite)

## What it is

A web app for managers of small teams (cafés, bars, shops, clinics, volunteer groups) who collect staff availability in a WhatsApp, Telegram or LINE group. The manager pastes the chat. Each message becomes a **quoted constraint** that the manager confirms. A deterministic solver then builds the week's rota under the team's rest and hours rules, and shows exactly which message blocks each uncovered shift.

## How to get in (no sign-up needed)

- Open `/` and click **"Try the demo café, no sign-up"**. That creates a **brand-new, private demo workspace** every time and opens its week board at `/week/<id>`.
- **Every test journey must start by clicking that button**, so it begins from the same fresh state. Never reuse a workspace between journeys.
- Email/password accounts also exist: `/register` (email + password of 8+ characters) and `/login`.

## The seeded demo (identical in every fresh demo workspace)

- Corner Café, time zone Europe/London, manager Lou. Rota week: **Mon 19 Oct to Sun 25 Oct 2026**. UK clocks go back on Sun 25 Oct at 02:00.
- 9 staff: Ana Costa, Ben Okafor, Dara Kim, Sam Lee (the four **key holders**), Priya Nair (baker), Kofi Mensah, Mei Tanaka, Tom Byrne, Jo Silva.
- 22 shifts. Opens and closes need a key holder. Ben is **pinned** to every weekday Close.
- 14 chat messages (Wed 14 to Sun 18 Oct), already read and confirmed, e.g. Ana "sat off pls", Sam "can't do tues after 4, also need sat off", Dara "no sat close for me sorry, gig that night".
- House rules **v3**: at least 11 h rest between shifts, at most 40 h a week, one shift a day.

## What the week board shows on a fresh demo

- A large coverage figure **"21/22"** next to **"shifts covered"**, and the line "1 needs a key holder: Sat 24 Oct Close".
- "Checked against House rules v3 · 0 rest gaps under 11 h · 0 violations".
- A gate card: "Only confirmed messages count" with "15 confirmed · 0 waiting for you · 0 to ask about".
- Left: a **"Paste from the group chat"** box (textarea, a consent checkbox, a **"Read messages"** button and a **"Use a sample message"** link), then the staff chat, one card per message, each with its constraint chips. A confirmed chip shows the constraint and the quote, e.g. `Unavailable · Sat 24 Oct, all day "sat off pls"`.
- Right: **"The rota"**: one column per day (Mon 19 to Sun 25), one index card per shift showing the label, times and the person's first name.
- The **Sat 24 Oct Close** card says **"Not covered"** (red). Below the rota, a red panel titled "Sat 24 Oct Close · 14:00–22:00 · not covered" says "Needs a key holder. All 4 are blocked:" and lists:
  - Ana unavailable all day Sat 24 Oct: "sat off pls"
  - Ben at max 40.0 h
  - Dara unavailable for Close on Sat 24 Oct: "no sat close for me sorry"
  - Sam unavailable all day Sat 24 Oct: "need sat off"
  - and "The other 5 staff aren't key holders."
- The **Sat 24 Oct Night bake** card (Priya) notes "9.0 h · clocks go back": the shift runs 22:00 to 06:00 across the clock change.
- Who works the weekday opens may change as fairness rules improve. Assert coverage, the uncovered shift, its blockers, and the hours of named shifts, not who opens on Tuesday.

## Core journeys

1. **Try demo:** "21/22" shifts covered, Sat 24 Oct Close not covered, with the four blockers above.
2. **Confirm a new message:** click "Use a sample message" (fills `[18/10/2026, 21:30:02] Ana: actually I can do sat close now`), tick the consent box, click "Read messages". A message from Ana appears with a **PROPOSED** chip, `Available · Sat 24 Oct Close`, quoting "actually I can do sat close now", with checks (✓ quote is in the message, ✓ Ana → Ana Costa, ✓ sat → Sat 24 Oct). Coverage still reads 21/22. Click **Confirm**: coverage becomes **"22/22"**, every shift is covered, and the Sat 24 Oct Close card shows **Ana**. After a page reload it is still 22/22.
3. **Reject instead:** same paste, click **Reject**: the chip shows "Rejected" and coverage stays 21/22.
4. **The confirm gate:** paste `[18/10/2026, 22:10:15] Dara: might be busy weekend idk` with consent. An **ASK** item appears with a drafted reply to post back in the chat and a "Copy reply" button. Coverage stays 21/22 and the gate card shows "1 to ask about".
5. **Why this person:** click the Sat 24 Oct **Open** card. A panel opens showing **Dara Kim** on the shift, "The only one with the role who could take it.", and Ana blocked with the quote "sat off pls". Close it with **Close** or Escape.
6. **Clock change:** click the Sat 24 Oct **Night bake** card. The panel says "Clocks go back at 02:00 during this shift, so it lasts 9.0 h." Priya is on it.
7. **Consent is required:** type any message, leave the checkbox unticked and click "Read messages". It shows "Tick the box to confirm your team agreed first." and adds nothing.
8. **Copy formats are read before the AI:** paste a WhatsApp Android US export line such as `10/18/26, 9:30 PM - Ana: actually I can do sat close now` (consent ticked). The status line says "Read as WhatsApp (Android export) · dates month/day (detected)".
9. **Accounts:** register with a new email and an 8+ character password; you land on your own copy of the café board. Signing in with a wrong password shows "Email or password is wrong."
10. **Bad links:** `/week/<random id>` shows "This rota isn't here".
11. **Publish and paste back:** on a fresh demo click **Publish rota**. A dialog asks "Publish the week of Mon 19 Oct?" and lists "21/22 shifts covered; 1 still open." Click **Publish rota** in the dialog. The board shows a **Published** badge and the note "Published. The rota is locked and everyone has a private link."; the paste box is gone. A panel "Published. Paste this back into the group" shows the reply for the group chat: it starts "📋 Rota for w/c Mon 19 Oct is up", has one line per day (e.g. "Sat 24 Oct: Open Dara …"), and ends the gaps with "⚠️ Still need a key holder for Sat 24 Oct Close (14:00–22:00). Can anyone help?". Below it are **9 private links**, one per person ("Open Priya's shifts"). After a reload the board is still published with the same panel.
12. **A staff member's link:** open Priya's private link. The page "Priya's shifts" shows **25.0 h** and "3 shifts", her three Night bake cards, and on Sat 24 Oct "9.0 h · clocks go back at 02:00, so this shift is an hour longer". A "Fairness receipt" reads "Checked against House rules v3" and "21/22 shifts covered this week". No one else's shifts appear. A changed link such as `/s/shr_wrong` shows "This link doesn't work".
13. **Write a vague message yourself:** paste `[18/10/2026, 22:10:15] Dara: might be busy weekend idk` with consent. A **"Waiting for you"** card says "1 message needs your answer before it counts:" and links to Dara's message, with the reason underneath. On the ASK item click **Write it myself**. A form "Write it yourself" opens with Who already set to **Dara Kim**. Set What **Can't work**, From day **Sat 24 Oct**, To day **Sun 25 Oct**, then click **Save and confirm**. The chip becomes confirmed, `Unavailable · Sat 24 and Sun 25 Oct`, still quoting "might be busy weekend idk". Coverage drops to **"20/22"** with "2 not covered: Sat 24 Oct Open, Sat 24 Oct Close"; the Sat 24 Oct Open panel lists Dara as blocked with her quote; the gate card reads "16 confirmed · 0 waiting for you · 0 to ask about", and the "Waiting for you" card is gone. **Cancel** on the form instead leaves the ASK item and 21/22 unchanged.
14. **Confirm all, quotes shown:** whenever AI proposals are waiting, the "Waiting for you" card lists every proposal with its person, what it means and its quote, then one button, "Confirm all N (quotes shown above)" ("Confirm it (quote shown above)" for one). After the sample message from journey 2 this button confirms Ana's proposal and coverage becomes 22/22. Ask items are never confirmed by it.

## API (base path `/api`, JSON, `Authorization: Bearer <token>`)

Full schema: `GET /api/openapi.json`.

- `POST /api/demo` → **201** `{token, workspaceId, weekId}`, a fresh seeded workspace.
- `POST /api/auth/register` `{email, password}` → 201; same email again → 409; bad email or a short password → 422. `POST /api/auth/login` → 200, wrong password → 401.
- `GET /api/weeks/{weekId}` → 200 with `solution.coverage = {covered: 21, total: 22}`, `solution.violations = []`, `rulePack.version = 3`, and exactly one `solution.uncovered` entry (shift key `sh_18`) whose blockers are Ana (`unavailable`, quote "sat off pls"), Ben (`max_hours`, detail "at max 40.0 h"), Dara (`unavailable`), Sam (`unavailable`), with `withoutRole = 5`. Shift `sh_19` has `hours = 9` and `crossesClockChange = true`.
- `POST /api/weeks/{weekId}/messages` `{text, consent: true}` → 201 with `format.app`, `format.dateOrder`, the new `messages` (UTC `sentAt`), and new `constraints`, none of them `confirmed`. Empty text → 422; missing consent → 422; invalid JSON → 422.
- `POST /api/constraints/{id}/confirm` → 200 with the re-solved `solution`; an incomplete Ask item → 422.
- `PATCH /api/constraints/{id}` edits a constraint, including an Ask item, which then becomes `proposed` and still needs confirming; a date outside the rota week → 422. Dara's vague message written as `{kind: "unavailable", dateFrom: "2026-10-24", dateTo: "2026-10-25"}` and confirmed → coverage 20/22, uncovered `sh_15` and `sh_18`.
- `POST /api/weeks/{weekId}/solve` → 200, identical assignments on every call; only confirmed constraints count.
- `POST /api/weeks/{weekId}/confirm-all` → 200, confirms every complete proposed constraint.
- `GET /api/weeks/{weekId}/shifts/{shiftId}/why` → who is on the shift, their rest either side, and each other person's blocking rule.
- `PATCH /api/staff/{id}` `{maxHours}`: −5 → 422.
- `POST /api/weeks/{weekId}/publish` → **201** `{receipt, shareLinks, chatBack}`: `receipt` has `covered = 21`, `total = 22`, `shortRestGaps = 0`, `violations = 0`, `rulePack = "House rules v3"`; `shareLinks` has 9 entries with URLs containing `/s/shr_`; `chatBack` contains "Rota for w/c Mon 19 Oct is up". Publishing again → 409. Once published, solve, paste and confirm on that week → 409. `GET /api/weeks/{weekId}/publish` → 200 with the same links.
- `GET /api/share/{token}` (no auth; the token is the credential) → 200 with that person's `staff`, `shifts` and `totals` only; Priya: 3 Night bakes, `totals.hours = 25`, the Sat 24 Oct one with `hours = 9` and `crossesClockChange = true`. A changed token → 404. A share token used as a Bearer token on manager endpoints → 403.
- `DELETE /api/workspaces/{id}` → 204, then `GET /api/workspaces/{id}` → 404.
- **Security:** no token → 401; a forged or tampered JWT → 401; another workspace's week, constraint or staff id → 404.
- `POST /api/parse-chat` `{text, timezone}` (no auth): how a paste is read, e.g. an Android US line gives `app = "whatsapp-android"`, `dateOrder.value = "mdy"`; an unknown time zone → 422.

## AI behaviour in tests

On preview deployments the AI runs in **replay** mode: recorded model answers for known messages, so results are identical on every run. A message with no recording becomes an Ask item ("AI is in replay mode here and has no recording for this message."). It never fails the page.
