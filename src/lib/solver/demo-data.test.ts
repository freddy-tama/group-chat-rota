import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { activeRulePack, buildCornerCafeInput, CORNER_CAFE } from "@/lib/demo/corner-cafe";
import { dayWindow, localToInstant } from "@/lib/domain/time";

const domain = readFileSync(fileURLToPath(new URL("../../../docs/DOMAIN.md", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

describe("Corner Café seed data matches docs/DOMAIN.md", () => {
  it("chatText is the WhatsApp block byte for byte", () => {
    const block = /### The group chat[^\n]*\n\n```\n([\s\S]*?)\n```/.exec(domain)?.[1];
    expect(block).toBeDefined();
    expect(CORNER_CAFE.chatText).toBe(block);
  });

  it("messages m_01..m_14 are the chat lines, with UTC instants for their local times", () => {
    const lines = CORNER_CAFE.chatText.split("\n");
    expect(CORNER_CAFE.messages.map((m) => m.id)).toEqual(Array.from({ length: 14 }, (_, i) => `m_${String(i + 1).padStart(2, "0")}`));
    CORNER_CAFE.messages.forEach((m, i) => {
      const [, dd, mo, yyyy, time] = /^\[(\d\d)\/(\d\d)\/(\d{4}), (\d\d:\d\d:\d\d)\]/.exec(lines[i])!;
      expect(m.sentLocal).toBe(`${yyyy}-${mo}-${dd}T${time}`);
      expect(lines[i]).toBe(`[${dd}/${mo}/${yyyy}, ${time}] ${m.author}: ${m.text}`);
      expect(m.sentAt).toBe(localToInstant(m.sentLocal.slice(0, 10), m.sentLocal.slice(11), "Europe/London"));
    });
  });

  it("has the 9 staff and 22 shifts of the tables, with the 9 h night bake over the clock change", () => {
    expect(CORNER_CAFE.staff.map((s) => s.id)).toEqual(["st_ana", "st_ben", "st_dara", "st_sam", "st_priya", "st_kofi", "st_mei", "st_tom", "st_jo"]);
    expect(CORNER_CAFE.shifts.map((s) => s.id)).toEqual(Array.from({ length: 22 }, (_, i) => `sh_${String(i + 1).padStart(2, "0")}`));
    const sh19 = CORNER_CAFE.shifts.find((s) => s.id === "sh_19")!;
    expect(sh19).toMatchObject({ localDate: "2026-10-24", start: "2026-10-24T21:00:00.000Z", end: "2026-10-25T06:00:00.000Z", hours: 9 });
    expect(CORNER_CAFE.shifts.filter((s) => s.id !== "sh_19").every((s) => s.hours === 8 || s.hours === 6)).toBe(true);
    // Every table row is present with its hours.
    let rows = 0;
    for (const row of domain.matchAll(/^\| (sh_\d\d) \| \w{3} (\d\d) \| ([^|]+) \| (\d\d:\d\d)–(\d\d:\d\d) \| (\w+) \| \**(\d+)/gm)) {
      const [, id, dayOfMonth, label, start, end, role, hours] = row;
      expect(CORNER_CAFE.shifts.find((s) => s.id === id)).toMatchObject({
        localDate: `2026-10-${dayOfMonth}`,
        label: label.trim(),
        startLocal: start,
        endLocal: end,
        role,
        hours: Number(hours),
      });
      rows++;
    }
    expect(rows).toBe(22);
  });

  it("seed constraints carry every quote of the table, each from its author's message", () => {
    const section = domain.split("### Confirmed constraints the chat yields")[1].split("###")[0];
    const tableQuotes = [...section.matchAll(/\| "([^"]+)" \|$/gm)].map((m) => m[1]);
    expect(tableQuotes).toHaveLength(14);
    expect(new Set(CORNER_CAFE.seedConstraints.map((c) => c.quote))).toEqual(new Set(tableQuotes));
    const ids = CORNER_CAFE.seedConstraints.map((c) => c.id);
    expect(ids).toEqual(Array.from({ length: 21 }, (_, i) => `c_${String(i + 1).padStart(2, "0")}`));
    for (const c of CORNER_CAFE.seedConstraints) {
      const staff = CORNER_CAFE.staff.find((s) => s.id === c.staffId)!;
      const msg = CORNER_CAFE.messages.find((m) => m.sentAt === c.sentAt);
      expect(msg, c.id).toBeDefined();
      expect(staff.aliases).toContain(msg!.author.toLowerCase());
      expect(msg!.text).toContain(c.quote);
    }
    // sorted by id == sorted by message time
    const sent = CORNER_CAFE.seedConstraints.map((c) => c.sentAt);
    expect([...sent].sort()).toEqual(sent);
  });

  it("resolves windows to whole local days, from/until times and the 25 h Sunday", () => {
    const byId = Object.fromEntries(CORNER_CAFE.seedConstraints.map((c) => [c.id, c]));
    expect(byId.c_01).toMatchObject({ kind: "unavailable", ...dayWindow("2026-10-24", "Europe/London"), shiftLabel: null });
    expect(byId.c_02).toMatchObject({ start: "2026-10-20T15:00:00.000Z", end: "2026-10-20T23:00:00.000Z" });
    expect(byId.c_04).toMatchObject({ shiftLabel: "Close", start: "2026-10-23T23:00:00.000Z", end: "2026-10-24T23:00:00.000Z" });
    expect(byId.c_05).toMatchObject({ start: "2026-10-24T23:00:00.000Z", end: "2026-10-26T00:00:00.000Z" }); // 25 h
    expect(byId.c_07).toMatchObject({ start: "2026-10-18T23:00:00.000Z", end: "2026-10-21T23:00:00.000Z" });
    expect(byId.c_09).toMatchObject({ shiftLabel: "Close", start: "2026-10-18T23:00:00.000Z", end: "2026-10-26T00:00:00.000Z" });
    expect(byId.c_16).toMatchObject({ kind: "prefer", staffId: "st_kofi", start: "2026-10-24T23:00:00.000Z", end: "2026-10-25T12:00:00.000Z" });
    expect(byId.c_17).toMatchObject({ start: "2026-10-22T23:00:00.000Z", end: "2026-10-23T10:00:00.000Z" });
    expect(byId.c_08).toMatchObject({ kind: "max_shifts", value: 2, staffId: "st_jo" });
  });

  it("activeRulePack picks the latest pack in force", () => {
    expect(activeRulePack("2026-10-19")).toMatchObject({ version: 3, minRestHours: 11, maxHoursDefault: 40, maxShiftsPerDay: 1 });
    expect(activeRulePack("2026-10-12")).toMatchObject({ version: 2, minRestHours: 10 });
    expect(() => activeRulePack("2026-08-31")).toThrow();
  });

  it("buildCornerCafeInput returns fresh copies with extra constraints appended", () => {
    const a = buildCornerCafeInput();
    a.staff[0].maxHours = 1;
    a.constraints.length = 0;
    const b = buildCornerCafeInput([{ id: "c_99", staffId: "st_jo", kind: "max_hours", value: 8, sentAt: "2026-10-18T20:00:00.000Z", quote: "x" }]);
    expect(b.staff[0].maxHours).toBe(40);
    expect(b.constraints).toHaveLength(22);
    expect(b.rulePack.version).toBe(3);
    expect(b.pins).toHaveLength(5);
  });
});
