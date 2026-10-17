// Publishing: the lock, the staff links (own shifts only), the receipt and the chat-back reply.
import { describe, expect, it } from "vitest";
import { POST as demo } from "@/app/api/demo/route";
import { GET as getWeek } from "@/app/api/weeks/[id]/route";
import { POST as solveWeek } from "@/app/api/weeks/[id]/solve/route";
import { POST as paste } from "@/app/api/weeks/[id]/messages/route";
import { POST as publish, GET as getPublished } from "@/app/api/weeks/[id]/publish/route";
import { GET as share } from "@/app/api/share/[token]/route";
import { POST as confirm } from "@/app/api/constraints/[id]/confirm/route";

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;
async function call<P>(h: Handler<P>, opts: { method?: string; token?: string; body?: unknown; params?: P } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await h(new Request("http://localhost/api/x", { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve((opts.params ?? {}) as P) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("Publishing a week", () => {
  it("locks the rota, creates one link per person and drafts the group reply", async () => {
    const d = (await call(demo, { method: "POST" })).body;
    const p = await call(publish, { method: "POST", token: d.token, params: { id: d.weekId } });
    expect(p.status).toBe(201);
    expect(p.body.shareLinks).toHaveLength(9);
    expect(p.body.receipt).toMatchObject({ covered: 21, total: 22, shortRestGaps: 0, violations: 0, rulePack: "House rules v3" });
    expect(p.body.chatBack).toContain("Rota for w/c Mon 19 Oct is up");
    expect(p.body.chatBack).toContain("Still need a key holder for Sat 24 Oct Close (14:00–22:00)");
    expect(p.body.chatBack).toContain("Sat 24 Oct: Open Dara");
    expect(p.body.shareLinks[0].url).toMatch(/\/s\/shr_/);

    expect((await call(publish, { method: "POST", token: d.token, params: { id: d.weekId } })).status).toBe(409);
    expect((await call(solveWeek, { method: "POST", token: d.token, params: { id: d.weekId } })).status).toBe(409);
    expect((await call(paste, { token: d.token, body: { text: "Ana: hi", consent: true }, params: { id: d.weekId } })).status).toBe(409);
    const w = (await call(getWeek, { token: d.token, params: { id: d.weekId } })).body;
    expect(w.week.status).toBe("published");
    expect((await call(confirm, { method: "POST", token: d.token, params: { id: w.constraints[0].id } })).status).toBe(409);
    expect((await call(getPublished, { token: d.token, params: { id: d.weekId } })).body.shareLinks).toHaveLength(9);
  });

  it("a staff link shows only that person's shifts; Priya works 25.0 h across the clock change", async () => {
    const d = (await call(demo, { method: "POST" })).body;
    const p = (await call(publish, { method: "POST", token: d.token, params: { id: d.weekId } })).body;
    const priya = p.shareLinks.find((l: { name: string }) => l.name === "Priya Nair");
    const token = priya.url.split("/s/")[1];
    const s = await call(share, { params: { token } });
    expect(s.status).toBe(200);
    expect(s.body.staff.name).toBe("Priya Nair");
    expect(s.body.shifts.map((x: { label: string }) => x.label)).toEqual(["Night bake", "Night bake", "Night bake"]);
    expect(s.body.totals).toMatchObject({ shifts: 3, hours: 25, hoursLabel: "25.0 h" });
    expect(s.body.shifts[2]).toMatchObject({ localDate: "2026-10-24", hours: 9, crossesClockChange: true });
    expect(JSON.stringify(s.body)).not.toContain("Ana Costa");
  });

  it("a tampered link is 404, and a staff link can't act as the manager (403)", async () => {
    const d = (await call(demo, { method: "POST" })).body;
    const p = (await call(publish, { method: "POST", token: d.token, params: { id: d.weekId } })).body;
    const token: string = p.shareLinks[0].url.split("/s/")[1];
    expect((await call(share, { params: { token: token.slice(0, -2) + "xx" } })).status).toBe(404);
    expect((await call(getWeek, { token, params: { id: d.weekId } })).status).toBe(403);
    expect((await call(publish, { method: "POST", token, params: { id: d.weekId } })).status).toBe(403);
  });

  it("another workspace can't publish your week (404)", async () => {
    const a = (await call(demo, { method: "POST" })).body;
    const b = (await call(demo, { method: "POST" })).body;
    expect((await call(publish, { method: "POST", token: b.token, params: { id: a.weekId } })).status).toBe(404);
  });
});
