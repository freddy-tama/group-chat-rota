// End-to-end API tests: the real route handlers on an in-process Postgres (PGlite).
// These mirror the backend cases in the TestSprite suite, so a regression shows here first.
import { describe, expect, it, beforeAll } from "vitest";
import { POST as demo } from "@/app/api/demo/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/me/route";
import { GET as getWeek } from "@/app/api/weeks/[id]/route";
import { POST as solveWeek } from "@/app/api/weeks/[id]/solve/route";
import { POST as paste } from "@/app/api/weeks/[id]/messages/route";
import { POST as confirmAll } from "@/app/api/weeks/[id]/confirm-all/route";
import { GET as why } from "@/app/api/weeks/[id]/shifts/[shiftId]/why/route";
import { POST as confirm } from "@/app/api/constraints/[id]/confirm/route";
import { PATCH as patchConstraint } from "@/app/api/constraints/[id]/route";
import { GET as getWorkspace, DELETE as deleteWorkspace } from "@/app/api/workspaces/[id]/route";
import { PATCH as patchStaff } from "@/app/api/staff/[id]/route";
import { POST as parseChat } from "@/app/api/parse-chat/route";
import { GET as health } from "@/app/api/health/route";

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

async function call<P>(h: Handler<P>, opts: { method?: string; token?: string; body?: unknown; params?: P; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request("http://localhost/api/test", {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
  const res = await h(req, { params: Promise.resolve((opts.params ?? {}) as P) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function newDemo() {
  const r = await call(demo, { method: "POST" });
  expect(r.status).toBe(201);
  return r.body as { token: string; workspaceId: string; weekId: string };
}

describe("Try demo and the seeded week", () => {
  let d: Awaited<ReturnType<typeof newDemo>>;
  beforeAll(async () => {
    d = await newDemo();
  });

  it("sets a session cookie and returns a token", async () => {
    const r = await call(demo, { method: "POST" });
    expect(r.headers.get("set-cookie")).toMatch(/gcr_session=/);
    expect(r.body.token).toMatch(/^ey/);
  });

  it("shows 21/22 covered with Sat 24 Oct Close blocked by every key holder", async () => {
    const r = await call(getWeek, { token: d.token, params: { id: d.weekId } });
    expect(r.status).toBe(200);
    const w = r.body;
    expect(w.solution.coverage).toEqual({ covered: 21, total: 22 });
    expect(w.solution.violations).toEqual([]);
    expect(w.rulePack.version).toBe(3);
    expect(w.solution.uncovered).toHaveLength(1);
    const u = w.solution.uncovered[0];
    const shift = w.shifts.find((s: { id: string }) => s.id === u.shiftId);
    expect(shift).toMatchObject({ key: "sh_18", label: "Close", localDate: "2026-10-24" });
    const name = (id: string) => w.staff.find((s: { id: string }) => s.id === id).name;
    const blockers = Object.fromEntries(u.blockers.map((b: { staffId: string }) => [name(b.staffId), b]));
    expect(blockers["Ana Costa"]).toMatchObject({ reason: "unavailable", quote: "sat off pls" });
    expect(blockers["Ben Okafor"]).toMatchObject({ reason: "max_hours", detail: "at max 40.0 h" });
    expect(blockers["Dara Kim"]).toMatchObject({ reason: "unavailable", quote: "no sat close for me sorry" });
    expect(blockers["Sam Lee"]).toMatchObject({ reason: "unavailable", quote: "need sat off" });
    expect(u.withoutRole).toBe(5);
  });

  it("measures the clock-change night bake as 9 h and gives Priya 25.0 h", async () => {
    const w = (await call(getWeek, { token: d.token, params: { id: d.weekId } })).body;
    const bake = w.shifts.find((s: { key: string }) => s.key === "sh_19");
    expect(bake.hours).toBe(9);
    expect(bake.crossesClockChange).toBe(true);
    const priya = w.staff.find((s: { name: string }) => s.name === "Priya Nair");
    expect(w.solution.totals.find((t: { staffId: string }) => t.staffId === priya.id)).toMatchObject({ hours: 25, shifts: 3 });
  });

  it("solves identically every time", async () => {
    const runs = await Promise.all(Array.from({ length: 5 }, () => call(solveWeek, { method: "POST", token: d.token, params: { id: d.weekId } })));
    const shapes = runs.map((r) => JSON.stringify(r.body.assignments));
    expect(new Set(shapes).size).toBe(1);
  });

  it("explains Sat 24 Oct Open: Dara is the only key holder free", async () => {
    const w = (await call(getWeek, { token: d.token, params: { id: d.weekId } })).body;
    const sh15 = w.shifts.find((s: { key: string }) => s.key === "sh_15");
    const r = await call(why, { token: d.token, params: { id: d.weekId, shiftId: sh15.id } });
    expect(r.status).toBe(200);
    const dara = w.staff.find((s: { name: string }) => s.name === "Dara Kim");
    expect(r.body.assignee.staffId).toBe(dara.id);
    const ana = w.staff.find((s: { name: string }) => s.name === "Ana Costa");
    expect(r.body.candidates.find((c: { staffId: string }) => c.staffId === ana.id)).toMatchObject({ status: "blocked", quote: "sat off pls" });
  });
});

describe("Auth and isolation", () => {
  it("401 without a session, 401 with a forged token", async () => {
    const d = await newDemo();
    expect((await call(getWeek, { params: { id: d.weekId } })).status).toBe(401);
    const [h, p] = d.token.split(".");
    const forged = `${h}.${p}.${"A".repeat(43)}`;
    expect((await call(getWeek, { token: forged, params: { id: d.weekId } })).status).toBe(401);
  });

  it("404 for another workspace's week, constraint or staff (no IDOR)", async () => {
    const a = await newDemo();
    const b = await newDemo();
    expect((await call(getWeek, { token: b.token, params: { id: a.weekId } })).status).toBe(404);
    const wa = (await call(getWeek, { token: a.token, params: { id: a.weekId } })).body;
    expect((await call(confirm, { method: "POST", token: b.token, params: { id: wa.constraints[0].id } })).status).toBe(404);
    expect((await call(patchStaff, { method: "PATCH", token: b.token, body: { maxHours: 10 }, params: { id: wa.staff[0].id } })).status).toBe(404);
  });

  it("registers, signs in, and rejects a wrong password", async () => {
    const email = `lou+${Date.now()}@example.com`;
    const r = await call(register, { body: { email, password: "corkboard-42" } });
    expect(r.status).toBe(201);
    expect(r.body.weekId).toBeTruthy();
    expect((await call(register, { body: { email, password: "corkboard-42" } })).status).toBe(409);
    expect((await call(login, { body: { email, password: "corkboard-42" } })).status).toBe(200);
    expect((await call(login, { body: { email, password: "wrong-password" } })).status).toBe(401);
    expect((await call(register, { body: { email: "not-an-email", password: "x" } })).status).toBe(422);
    const m = await call(me, { token: r.body.token });
    expect(m.body.workspaces).toHaveLength(1);
  });

  it("deletes a workspace: 204, then 404", async () => {
    const d = await newDemo();
    expect((await call(deleteWorkspace, { method: "DELETE", token: d.token, params: { id: d.workspaceId } })).status).toBe(204);
    expect((await call(getWorkspace, { token: d.token, params: { id: d.workspaceId } })).status).toBe(404);
    expect((await call(getWeek, { token: d.token, params: { id: d.weekId } })).status).toBe(404);
  });

  it("validates staff edits: negative hours is 422", async () => {
    const d = await newDemo();
    const w = (await call(getWeek, { token: d.token, params: { id: d.weekId } })).body;
    expect((await call(patchStaff, { method: "PATCH", token: d.token, body: { maxHours: -5 }, params: { id: w.staff[0].id } })).status).toBe(422);
    expect((await call(patchStaff, { method: "PATCH", token: d.token, body: { maxHours: 30 }, params: { id: w.staff[0].id } })).body.staff.maxHours).toBe(30);
  });
});

describe("Pasting the chat: the confirm gate", () => {
  it("rejects an empty paste and a paste without consent", async () => {
    const d = await newDemo();
    expect((await call(paste, { token: d.token, body: { text: "   ", consent: true }, params: { id: d.weekId } })).status).toBe(422);
    expect((await call(paste, { token: d.token, body: { text: "Ana: hi" }, params: { id: d.weekId } })).status).toBe(422);
    expect((await call(paste, { token: d.token, body: "not json", params: { id: d.weekId } })).status).toBe(422);
  });

  it("reads the copy format before the AI and leaves the rota alone until confirmed", async () => {
    const d = await newDemo();
    const r = await call(paste, {
      token: d.token,
      body: { text: "[18/10/2026, 21:30:02] Ana: actually I can do sat close now", consent: true },
      params: { id: d.weekId },
    });
    expect(r.status).toBe(201);
    expect(r.body.format.app).toBe("whatsapp-ios");
    expect(r.body.format.dateOrder).toEqual({ value: "dmy", basis: "detected" });
    expect(r.body.messages[0].sentAt).toBe("2026-10-18T20:30:02.000Z");
    expect(r.body.constraints.length).toBeGreaterThan(0);
    expect(r.body.constraints.every((c: { status: string }) => c.status !== "confirmed")).toBe(true);
    expect(r.body.solution.coverage).toEqual({ covered: 21, total: 22 });
  });

  it("an edited and confirmed 'available' for Ana covers Sat Close: 22/22", async () => {
    const d = await newDemo();
    const r = await call(paste, {
      token: d.token,
      body: { text: "[18/10/2026, 21:30:02] Ana: actually I can do sat close now", consent: true },
      params: { id: d.weekId },
    });
    const w = (await call(getWeek, { token: d.token, params: { id: d.weekId } })).body;
    const ana = w.staff.find((s: { name: string }) => s.name === "Ana Costa");
    const item = r.body.constraints[0];
    // Whatever the AI proposed (or couldn't), the manager can set it exactly; it still needs confirming.
    const edited = await call(patchConstraint, {
      method: "PATCH", token: d.token, params: { id: item.id },
      body: { staffId: ana.id, kind: "available", dateFrom: "2026-10-24", dateTo: "2026-10-24", timeFrom: null, timeTo: null, shiftLabel: "Close" },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.constraint.status).toBe("proposed");
    expect((await call(solveWeek, { method: "POST", token: d.token, params: { id: d.weekId } })).body.coverage.covered).toBe(21);
    const c = await call(confirm, { method: "POST", token: d.token, params: { id: item.id } });
    expect(c.status).toBe(200);
    expect(c.body.solution.coverage).toEqual({ covered: 22, total: 22 });
    expect(c.body.solution.violations).toEqual([]);
    const sh18 = w.shifts.find((s: { key: string }) => s.key === "sh_18");
    expect(c.body.solution.assignments.find((a: { shiftId: string }) => a.shiftId === sh18.id).staffId).toBe(ana.id);
  });

  it("writing a vague message yourself: Dara off all weekend leaves Sat Open with no key holder", async () => {
    const d = await newDemo();
    const r = await call(paste, { token: d.token, body: { text: "[18/10/2026, 22:10:15] Dara: might be busy weekend idk", consent: true }, params: { id: d.weekId } });
    expect(r.status).toBe(201);
    const item = r.body.constraints[0];
    expect(item.status).toBe("ask");
    // An Ask item can't be confirmed as it stands.
    expect((await call(confirm, { method: "POST", token: d.token, params: { id: item.id } })).status).toBe(422);
    const w = (await call(getWeek, { token: d.token, params: { id: d.weekId } })).body;
    expect(w.counts.ask).toBe(1);
    const dara = w.staff.find((s: { name: string }) => s.name === "Dara Kim");
    const edited = await call(patchConstraint, {
      method: "PATCH", token: d.token, params: { id: item.id },
      body: { staffId: dara.id, kind: "unavailable", dateFrom: "2026-10-24", dateTo: "2026-10-25", timeFrom: null, timeTo: null, shiftLabel: null },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.constraint.status).toBe("proposed");
    const c = await call(confirm, { method: "POST", token: d.token, params: { id: item.id } });
    expect(c.status).toBe(200);
    const sol = c.body.solution;
    expect(sol.violations).toEqual([]);
    const sh15 = w.shifts.find((s: { key: string }) => s.key === "sh_15");
    const gap = sol.uncovered.find((u: { shiftId: string }) => u.shiftId === sh15.id);
    expect(gap).toBeTruthy();
    expect(gap.blockers.find((b: { staffId: string }) => b.staffId === dara.id).reason).toBe("unavailable");
    expect(sol.coverage.covered).toBeLessThan(21);
    expect(sol.assignments.some((a: { staffId: string; shiftId: string }) => a.staffId === dara.id && w.shifts.find((s: { id: string; localDate: string }) => s.id === a.shiftId).localDate >= "2026-10-24")).toBe(false);
    const after = (await call(getWeek, { token: d.token, params: { id: d.weekId } })).body;
    expect(after.counts.ask).toBe(0);
    expect(sol.coverage).toEqual({ covered: 20, total: 22 });
    expect(sol.uncovered.map((u: { shiftId: string }) => w.shifts.find((s: { id: string }) => s.id === u.shiftId).key).sort()).toEqual(["sh_15", "sh_18"]);
  });

  it("rejects an edit outside the rota week (422) and confirm-all only confirms complete items", async () => {
    const d = await newDemo();
    const r = await call(paste, { token: d.token, body: { text: "Jo: can't do mon either", consent: true }, params: { id: d.weekId } });
    const item = r.body.constraints[0];
    const bad = await call(patchConstraint, { method: "PATCH", token: d.token, params: { id: item.id }, body: { dateFrom: "2026-11-02" } });
    expect(bad.status).toBe(422);
    const all = await call(confirmAll, { method: "POST", token: d.token, body: {}, params: { id: d.weekId } });
    expect(all.status).toBe(200);
    expect(all.body.solution.violations).toEqual([]);
  });
});

describe("Stateless helpers", () => {
  it("parse-chat reads an Android export with month/day dates", async () => {
    const r = await call(parseChat, { body: { text: "10/14/26, 9:12 AM - Ana: sat off pls\n10/14/26, 9:40 AM - Ben: usual for me", timezone: "Europe/London" } });
    expect(r.status).toBe(200);
    expect(r.body.app).toBe("whatsapp-android");
    expect(r.body.dateOrder.value).toBe("mdy");
    expect(r.body.messages).toHaveLength(2);
    expect(r.body.messages[0].sentAt).toBe("2026-10-14T08:12:00.000Z");
  });

  it("parse-chat: unknown time zone is 422", async () => {
    expect((await call(parseChat, { body: { text: "Ana: hi", timezone: "Mars/Olympus" } })).status).toBe(422);
  });

  it("health reports the database and AI mode", async () => {
    const r = await call(health);
    expect(r.body).toMatchObject({ ok: true, db: "pglite", aiMode: "replay" });
  });
});
