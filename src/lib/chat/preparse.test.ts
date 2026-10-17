import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { preparseChat, redactForModel, type PreparseResult } from "./preparse";

const FIXTURES = fileURLToPath(new URL("./__fixtures__/", import.meta.url));
const load = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const LONDON = { timezone: "Europe/London" };
const parse = (text: string, extra: { defaultDateOrder?: "dmy" | "mdy"; anchor?: string; timezone?: string } = {}) =>
  preparseChat(text, { timezone: "Europe/London", ...extra });

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CORE_AUTHORS = ["Ana", "Ben", "Dara", "Sam", "Priya", "Lou", "Mei", "Tom", "Jo", "Lou"];
const MULTI = "I can do:\nMon open\nThu close\nbut not Fri please";

// The same week (Wed 14 - Sun 18 Oct 2026, Europe/London, BST = UTC+1) in every locale and app.
const CORE_SENT_AT = [
  "2026-10-14T08:12:00.000Z", // Ana 09:12 BST
  "2026-10-14T08:15:00.000Z", // Ben
  "2026-10-14T08:20:00.000Z", // Dara
  "2026-10-14T08:31:00.000Z", // Sam
  "2026-10-14T17:02:00.000Z", // Priya, multi-line
  "2026-10-14T17:10:00.000Z", // Lou
  "2026-10-15T09:01:00.000Z", // Mei
  "2026-10-16T21:47:00.000Z", // Tom 22:47 BST
  "2026-10-17T07:16:00.000Z", // Jo
  "2026-10-18T20:04:00.000Z", // Lou 21:04 BST
];
const withSeconds = (secs: string[]) => CORE_SENT_AT.map((iso, i) => iso.replace(":00.000Z", `:${secs[i]}.000Z`));

interface Case {
  file: string;
  app: PreparseResult["app"];
  dateOrder: PreparseResult["dateOrder"];
  clock: PreparseResult["clock"];
  authors: string[];
  sentAt: string[];
  multiIndex: number;
  multiText: string;
  skipped: [number, PreparseResult["skipped"][number]["reason"]][];
}

const CASES: Case[] = [
  {
    file: "whatsapp-ios-gb.txt",
    app: "whatsapp-ios",
    dateOrder: { value: "dmy", basis: "detected" },
    clock: "24h",
    authors: CORE_AUTHORS,
    sentAt: withSeconds(["40", "11", "30", "05", "44", "00", "09", "31", "20", "12"]),
    multiIndex: 4,
    multiText: "I can do:\nMon open\nThu close\n\nbut not Fri please",
    skipped: [
      [1, "system"],
      [2, "system"],
      [4, "media"],
      [5, "media"],
      [17, "deleted"],
    ],
  },
  {
    file: "whatsapp-ios-us.txt",
    app: "whatsapp-ios",
    dateOrder: { value: "mdy", basis: "detected" },
    clock: "12h",
    authors: ["Ana", "Ben", "Dara", "Sam", "Priya", "Lou", "Mei", "Tom", "Kofi", "Lou"],
    sentAt: [
      "2026-10-14T08:12:40.000Z",
      "2026-10-14T08:15:11.000Z",
      "2026-10-14T08:20:30.000Z",
      "2026-10-14T08:31:05.000Z",
      "2026-10-14T17:02:44.000Z",
      "2026-10-14T22:45:00.000Z", // 11:45 PM BST
      "2026-10-14T23:30:15.000Z", // 12:30:15 AM on the 15th = 00:30 BST
      "2026-10-15T11:15:00.000Z", // 12:15 PM = 12:15 BST
      "2026-10-16T21:47:31.000Z",
      "2026-10-18T20:04:12.000Z",
    ],
    multiIndex: 4,
    multiText: MULTI,
    skipped: [
      [1, "system"],
      [3, "media"],
    ],
  },
  {
    file: "whatsapp-android-gb.txt",
    app: "whatsapp-android",
    dateOrder: { value: "dmy", basis: "detected" },
    clock: "24h",
    authors: ["Ana", "Ben", "Dara", "Sam", "Priya", "Lou", "Mei", "Jo", "Lou", "Lou"],
    sentAt: [
      "2026-10-14T08:12:00.000Z",
      "2026-10-14T08:15:00.000Z",
      "2026-10-14T08:20:00.000Z",
      "2026-10-14T08:31:00.000Z",
      "2026-10-14T17:02:00.000Z",
      "2026-10-14T17:10:00.000Z",
      "2026-10-15T09:01:00.000Z",
      "2026-10-17T07:16:00.000Z",
      "2026-10-17T11:00:00.000Z",
      "2026-10-18T20:04:00.000Z",
    ],
    multiIndex: 4,
    multiText: MULTI,
    skipped: [
      [1, "system"],
      [2, "system"],
      [3, "system"],
      [4, "system"],
      [5, "system"],
      [6, "system"],
      [8, "media"],
      [18, "deleted"],
      [19, "deleted"],
    ],
  },
  {
    file: "whatsapp-android-us.txt",
    app: "whatsapp-android",
    dateOrder: { value: "mdy", basis: "detected" },
    clock: "12h",
    authors: ["Ana", "Ben", "Dara", "Sam", "Priya", "Lou", "Mei", "Tom", "Jo", "Lou"],
    sentAt: [
      "2026-10-14T08:12:00.000Z",
      "2026-10-14T08:15:00.000Z",
      "2026-10-14T08:20:00.000Z",
      "2026-10-14T08:31:00.000Z",
      "2026-10-14T17:02:00.000Z",
      "2026-10-14T22:45:00.000Z",
      "2026-10-14T23:30:00.000Z",
      "2026-10-15T11:15:00.000Z",
      "2026-10-17T07:16:00.000Z",
      "2026-10-18T20:04:00.000Z",
    ],
    multiIndex: 4,
    multiText: MULTI,
    skipped: [
      [1, "system"],
      [2, "system"],
      [3, "system"],
      [5, "media"],
      [16, "deleted"],
    ],
  },
  {
    file: "whatsapp-web-gb.txt",
    app: "whatsapp-web",
    dateOrder: { value: "dmy", basis: "detected" },
    clock: "24h",
    authors: CORE_AUTHORS,
    sentAt: CORE_SENT_AT,
    multiIndex: 4,
    multiText: MULTI,
    skipped: [[2, "media"]],
  },
  {
    file: "whatsapp-web-us.txt",
    app: "whatsapp-web",
    dateOrder: { value: "mdy", basis: "detected" },
    clock: "12h",
    authors: CORE_AUTHORS,
    sentAt: CORE_SENT_AT,
    multiIndex: 4,
    multiText: MULTI,
    skipped: [[2, "media"]],
  },
  {
    file: "telegram-desktop.txt",
    app: "telegram",
    dateOrder: { value: "dmy", basis: "detected" },
    clock: "24h",
    authors: ["Ana Costa", "Ben Moss", "Dara Singh", "Sam Lee", "Priya Nair", "Lou Hart", "Mei Tanaka", "Tom Reid", "Jo Park", "Lou Hart"],
    sentAt: CORE_SENT_AT,
    multiIndex: 4,
    multiText: MULTI,
    skipped: [[19, "media"]],
  },
  {
    file: "line-ja-style.txt",
    app: "line",
    dateOrder: { value: "ymd", basis: "detected" },
    clock: "24h",
    authors: CORE_AUTHORS,
    sentAt: CORE_SENT_AT,
    multiIndex: 4,
    multiText: MULTI,
    skipped: [
      [1, "header"],
      [2, "header"],
      [6, "media"],
      [8, "system"],
      [15, "deleted"],
    ],
  },
  {
    file: "line-en-style.txt",
    app: "line",
    dateOrder: { value: "mdy", basis: "detected" },
    clock: "12h",
    authors: ["Ana", "Ben", "Dara", "Sam", "Priya", "Lou", "Mei", "Tom", "Kofi", "Lou"],
    sentAt: [
      "2026-10-14T08:12:00.000Z",
      "2026-10-14T08:15:00.000Z",
      "2026-10-14T08:20:00.000Z",
      "2026-10-14T08:31:00.000Z",
      "2026-10-14T17:02:00.000Z",
      "2026-10-14T17:10:00.000Z",
      "2026-10-14T23:30:00.000Z", // 12:30 AM on the 15th = 00:30 BST
      "2026-10-15T11:15:00.000Z", // 12:15 PM
      "2026-10-16T21:47:00.000Z",
      "2026-10-18T20:04:00.000Z",
    ],
    multiIndex: 4,
    multiText: MULTI,
    skipped: [
      [1, "header"],
      [2, "header"],
      [6, "media"],
      [8, "system"],
      [15, "deleted"],
    ],
  },
  {
    file: "plain.txt",
    app: "plain",
    dateOrder: { value: "dmy", basis: "not-applicable" },
    clock: "none",
    authors: ["Ana", "Ben", "Dara", "Sam", "Priya", "Lou", "Mei", "Tom", "Jo"],
    sentAt: Array<string>(9).fill("2026-10-18T20:00:00.000Z"),
    multiIndex: 4,
    multiText: MULTI,
    skipped: [[5, "media"]],
  },
];

describe("fixtures", () => {
  for (const c of CASES) {
    describe(c.file, () => {
      const r = parse(load(c.file), { anchor: "2026-10-18T20:00:00.000Z" });

      it("detects the app, date order and clock", () => {
        expect(r.app).toBe(c.app);
        expect(r.dateOrder).toEqual(c.dateOrder);
        expect(r.clock).toBe(c.clock);
      });

      it("finds every message with its author and exact UTC instant", () => {
        expect(r.messages).toHaveLength(c.authors.length);
        expect(r.messages.map((m) => m.author)).toEqual(c.authors);
        expect(r.messages.map((m) => m.sentAt)).toEqual(c.sentAt);
        expect(r.messages.map((m) => m.index)).toEqual(c.authors.map((_, i) => i));
      });

      it("keeps a multi-line message whole", () => {
        expect(r.messages[c.multiIndex].author).toBe("Priya" + (c.app === "telegram" ? " Nair" : ""));
        expect(r.messages[c.multiIndex].text).toBe(c.multiText);
      });

      it("skips system, media and deleted lines with the right reason", () => {
        expect(r.skipped.map((s) => [s.line, s.reason])).toEqual(c.skipped);
      });

      it("keeps emoji and apostrophes in the text", () => {
        expect(r.messages[0].text).toBe("sat off pls 🙏");
        expect(r.messages[1].text).toBe("can't do tues after 4, also need sat off");
        expect(r.messages[2].text).toBe("no sat close for me sorry, gig that night 🎸");
      });

      it("does not mark real timestamps as assumed (only plain is)", () => {
        const expected = c.app === "plain" ? "assumed" : "parsed";
        expect(new Set(r.messages.map((m) => m.timestamp))).toEqual(new Set([expected]));
      });
    });
  }

  it("reports no warnings for unambiguous pastes", () => {
    for (const c of CASES.filter((x) => x.app !== "plain")) {
      expect(parse(load(c.file)).warnings, c.file).toEqual([]);
    }
  });

  it("warns that plain pastes have no timestamps", () => {
    const r = parse(load("plain.txt"));
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/No dates or times/);
  });
});

describe("local dates and times", () => {
  it("reads month-first dates as month-first (10/14/26 is 14 October 2026)", () => {
    for (const file of ["whatsapp-ios-us.txt", "whatsapp-android-us.txt", "whatsapp-web-us.txt", "line-en-style.txt"]) {
      const r = parse(load(file));
      expect(r.messages[0].localDate, file).toBe("2026-10-14");
      expect(r.messages[0].localTime, file).toBe("09:12");
      expect(r.messages.at(-1)!.localDate, file).toBe("2026-10-18");
      expect(r.messages.at(-1)!.localTime, file).toBe("21:04");
    }
  });

  it("treats 12:xx AM as 00:xx and 12:xx PM as 12:xx", () => {
    const r = parse(load("whatsapp-ios-us.txt"));
    const mei = r.messages.find((m) => m.author === "Mei")!;
    expect(mei.sentAt).toBe("2026-10-14T23:30:15.000Z");
    expect(mei.localDate).toBe("2026-10-15");
    expect(mei.localTime).toBe("00:30");
    const tom = r.messages.find((m) => m.author === "Tom")!;
    expect(tom.localDate).toBe("2026-10-15");
    expect(tom.localTime).toBe("12:15");
  });

  it("gives the spec examples: 18/10/2026 21:04 London is 20:04Z, 26/10/2026 21:04 is 21:04Z", () => {
    const a = parse("[18/10/2026, 21:04:12] Lou: hi\n[26/10/2026, 21:04:12] Lou: hi again");
    expect(a.messages.map((m) => m.sentAt)).toEqual(["2026-10-18T20:04:12.000Z", "2026-10-26T21:04:12.000Z"]);
  });

  it("applies the GMT offset after the clocks go back on 25 Oct 2026", () => {
    const r = parse(load("whatsapp-android-gb-gmt.txt"));
    expect(r.app).toBe("whatsapp-android");
    expect(r.dateOrder).toEqual({ value: "dmy", basis: "detected" });
    expect(r.messages.map((m) => [m.localDate, m.localTime, m.sentAt])).toEqual([
      ["2026-10-24", "23:30", "2026-10-24T22:30:00.000Z"], // BST
      ["2026-10-25", "00:30", "2026-10-24T23:30:00.000Z"], // still BST (clocks change at 02:00)
      ["2026-10-25", "03:00", "2026-10-25T03:00:00.000Z"], // GMT
      ["2026-10-25", "12:00", "2026-10-25T12:00:00.000Z"],
      ["2026-10-26", "21:04", "2026-10-26T21:04:00.000Z"],
      ["2026-10-26", "21:10", "2026-10-26T21:10:00.000Z"],
    ]);
  });

  it("is DST-correct at the spring change too (29 Mar 2026)", () => {
    const r = parse("[29/03/2026, 00:30:00] Ana: a\n[29/03/2026, 03:30:00] Ana: b");
    expect(r.messages.map((m) => m.sentAt)).toEqual(["2026-03-29T00:30:00.000Z", "2026-03-29T02:30:00.000Z"]);
  });

  it("uses the zone it is given", () => {
    const r = parse("[14/10/2026, 09:12:00] Ana: hi", { timezone: "Asia/Jakarta" });
    expect(r.messages[0].sentAt).toBe("2026-10-14T02:12:00.000Z");
    expect(r.messages[0].localTime).toBe("09:12");
  });

  it("falls back to UTC with a warning for an unknown zone", () => {
    const r = parse("[14/10/2026, 09:12:00] Ana: hi", { timezone: "Not/AZone" });
    expect(r.messages[0].sentAt).toBe("2026-10-14T09:12:00.000Z");
    expect(r.warnings.join(" ")).toMatch(/time zone/);
  });
});

describe("date order", () => {
  it("assumes day/month, with a warning naming a date, when every date is <= 12", () => {
    const r = parse(load("ambiguous-dates.txt"));
    expect(r.app).toBe("whatsapp-ios");
    expect(r.dateOrder).toEqual({ value: "dmy", basis: "assumed" });
    expect(r.warnings).toEqual(["Dates like 05/10 could be day/month or month/day; assumed day/month."]);
    expect(r.messages.map((m) => m.localDate)).toEqual(["2026-10-05", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(r.messages[0].sentAt).toBe("2026-10-05T08:12:40.000Z");
  });

  it("honours defaultDateOrder for an ambiguous paste", () => {
    const r = parse(load("ambiguous-dates.txt"), { defaultDateOrder: "mdy" });
    expect(r.dateOrder).toEqual({ value: "mdy", basis: "assumed" });
    expect(r.warnings).toEqual(["Dates like 05/10 could be day/month or month/day; assumed month/day."]);
    expect(r.messages.map((m) => m.localDate)).toEqual(["2026-05-10", "2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"]);
  });

  it("does not let defaultDateOrder override evidence in the paste", () => {
    const r = parse(load("whatsapp-ios-gb.txt"), { defaultDateOrder: "mdy" });
    expect(r.dateOrder).toEqual({ value: "dmy", basis: "detected" });
    expect(r.messages[0].localDate).toBe("2026-10-14");
    const us = parse(load("whatsapp-ios-us.txt"), { defaultDateOrder: "dmy" });
    expect(us.dateOrder).toEqual({ value: "mdy", basis: "detected" });
  });

  it("decides from a single unambiguous date anywhere in the paste", () => {
    const text = "[05/10/2026, 09:12:40] Ana: hi\n[06/10/2026, 09:12:40] Ana: hi\n[14/10/2026, 09:12:40] Ana: hi";
    const r = parse(text);
    expect(r.dateOrder).toEqual({ value: "dmy", basis: "detected" });
    expect(r.messages.map((m) => m.localDate)).toEqual(["2026-10-05", "2026-10-06", "2026-10-14"]);
    const us = parse("[10/05/26, 9:12:40 AM] Ana: hi\n[10/14/26, 9:12:40 AM] Ana: hi");
    expect(us.dateOrder).toEqual({ value: "mdy", basis: "detected" });
    expect(us.messages.map((m) => m.localDate)).toEqual(["2026-10-05", "2026-10-14"]);
  });

  it("uses day/month with a warning when dates conflict, and still reads each date sensibly", () => {
    const r = parse("[14/10/2026, 09:12:40] Ana: a\n[10/14/2026, 09:12:40] Ben: b");
    expect(r.dateOrder).toEqual({ value: "dmy", basis: "assumed" });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/14\/10\/2026 and 10\/14\/2026/);
    expect(r.messages.map((m) => m.localDate)).toEqual(["2026-10-14", "2026-10-14"]);
  });

  it("treats dotted dates as day-first and reports that as detected", () => {
    const r = parse("[05.10.2026, 09:12:40] Ana: hi");
    expect(r.app).toBe("whatsapp-ios");
    expect(r.dateOrder).toEqual({ value: "dmy", basis: "detected" });
    expect(r.messages[0].localDate).toBe("2026-10-05");
  });

  it("reads year-first dates as year/month/day", () => {
    const r = parse("[2026/10/05 9:12:40] Ana: hi");
    expect(r.dateOrder).toEqual({ value: "ymd", basis: "detected" });
    expect(r.messages[0].localDate).toBe("2026-10-05");
  });

  it("turns two-digit years into 20yy", () => {
    const r = parse("14/10/26, 09:12 - Ana: hi");
    expect(r.messages[0].localDate).toBe("2026-10-14");
  });

  it("uses the weekday on LINE date lines to settle an ambiguous date", () => {
    // Mon 5 Oct 2026 is month-first 10/05; Wed 7 Oct 2026 is day-first 07/10.
    const monthFirst = parse("Mon, 10/05/2026\n09:12\tAna\tsat off");
    expect(monthFirst.dateOrder).toEqual({ value: "mdy", basis: "detected" });
    expect(monthFirst.messages[0].localDate).toBe("2026-10-05");
    const dayFirst = parse("Wed, 07/10/2026\n09:12\tAna\tsat off");
    expect(dayFirst.dateOrder).toEqual({ value: "dmy", basis: "detected" });
    expect(dayFirst.messages[0].localDate).toBe("2026-10-07");
    // No weekday and no evidence: assumed, with the warning.
    const none = parse("10/05/2026\n09:12\tAna\tsat off");
    expect(none.dateOrder.basis).toBe("assumed");
  });
});

describe("WhatsApp details", () => {
  it("reads iOS headers with and without seconds", () => {
    const r = parse("[14/10/2026, 09:12] Ana: a\n[14/10/2026, 09:12:40] Ana: b");
    expect(r.messages.map((m) => m.sentAt)).toEqual(["2026-10-14T08:12:00.000Z", "2026-10-14T08:12:40.000Z"]);
  });

  it("treats U+00A0 and U+202F before AM/PM as spaces", () => {
    const r = parse("10/14/26, 9:12 AM - Ana: a\n10/14/26, 9:13 AM - Ana: b\n[10/14/26, 9:14:00 PM] Ana: c");
    expect(r.messages).toHaveLength(2); // a, b; the iOS-style line is just a continuation of b
    expect(r.messages[1].text).toBe("b\n[10/14/26, 9:14:00 PM] Ana: c");
    expect(r.messages.map((m) => m.localTime)).toEqual(["09:12", "09:13"]);
  });

  it("strips the BOM, LRM/RLM marks and CRLF/CR line ends", () => {
    const lf = load("whatsapp-ios-gb.txt");
    const crlf = "﻿" + lf.replace(/\n/g, "\r\n");
    const cr = lf.replace(/\n/g, "\r");
    const marks = lf.replace(/ /g, " ‏");
    const base = parse(lf);
    expect(parse(crlf)).toEqual(base);
    expect(parse(cr)).toEqual(base);
    expect(parse(marks).messages.map((m) => m.sentAt)).toEqual(base.messages.map((m) => m.sentAt));
  });

  it("keeps author names as written, including emoji and You", () => {
    const r = parse("[14/10/2026, 09:12:40] You: hi\n[14/10/2026, 09:13:40] 🐱 Mia Lee 🐱: hello\n[14/10/2026, 09:14:40] ~ Jo: yo");
    expect(r.messages.map((m) => m.author)).toEqual(["You", "🐱 Mia Lee 🐱", "~ Jo"]);
  });

  it("splits at the first colon-space only, so colons in the message survive", () => {
    const r = parse("14/10/2026, 09:12 - Lou: new rule: max 2 shifts a day, 10:00 start");
    expect(r.messages[0].author).toBe("Lou");
    expect(r.messages[0].text).toBe("new rule: max 2 shifts a day, 10:00 start");
  });

  it("treats a system sentence with a colon in a quoted name as system, not as an author", () => {
    const r = parse('14/10/2026, 08:46 - Lou changed the subject from "Cafe: Crew" to "Corner"\n14/10/2026, 09:12 - Ana: hi');
    expect(r.messages).toHaveLength(1);
    expect(r.skipped.map((s) => s.reason)).toEqual(["system"]);
  });

  it("strips the 'message was edited' suffix and keeps a caption after an attachment marker", () => {
    const r = parse(
      "14/10/2026, 09:12 - Ana: sat off pls <This message was edited>\n14/10/2026, 09:13 - Ben: IMG-20261014-WA0001.jpg (file attached)\ncan't do tues",
    );
    expect(r.messages.map((m) => m.text)).toEqual(["sat off pls", "can't do tues"]);
  });

  it("reads Android exports whose time uses dots (e.g. Indonesian locale)", () => {
    const r = parse("14/10/26 09.12 - Ana: sat off pls", { timezone: "Asia/Jakarta" });
    expect(r.app).toBe("whatsapp-android");
    expect(r.messages[0].sentAt).toBe("2026-10-14T02:12:00.000Z");
  });

  it("picks the format with the most matching headers; stray lines of another format are body text", () => {
    const r = parse(
      "[14/10/2026, 09:12:40] Ana: one\n[14/10/2026, 09:13:40] Ben: two\n14/10/2026, 09:14 - Sam: three\n[14/10/2026, 09:15:40] Lou: four",
    );
    expect(r.app).toBe("whatsapp-ios");
    expect(r.messages.map((m) => m.author)).toEqual(["Ana", "Ben", "Lou"]);
    expect(r.messages[1].text).toBe("two\n14/10/2026, 09:14 - Sam: three");
  });

  it("skips a header with nothing after the colon as empty", () => {
    const r = parse("[14/10/2026, 09:12:40] Ana:\n[14/10/2026, 09:13:40] Ben: hi");
    expect(r.messages.map((m) => m.author)).toEqual(["Ben"]);
    expect(r.skipped).toEqual([{ line: 1, reason: "empty", text: "[14/10/2026, 09:12:40] Ana:" }]);
  });

  it("reports unparsed lines before the first message", () => {
    const r = parse("some words before\n\n[14/10/2026, 09:12:40] Ana: hi");
    expect(r.messages).toHaveLength(1);
    expect(r.skipped).toEqual([{ line: 1, reason: "unparsed", text: "some words before" }]);
  });

  it("records the line a message starts on", () => {
    const r = parse("[14/10/2026, 09:12:40] Ana: one\ntwo\nthree\n[14/10/2026, 09:13:40] Ben: four");
    expect(r.messages.map((m) => m.line)).toEqual([1, 4]);
    expect(r.messages[0].text).toBe("one\ntwo\nthree");
  });

  it("flags a date that is not on the calendar and keeps the message", () => {
    const r = parse("[31/02/2026, 09:12:40] Ana: hi", { anchor: "2026-10-18T20:00:00.000Z" });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].timestamp).toBe("assumed");
    expect(r.messages[0].sentAt).toBe("2026-10-18T20:00:00.000Z");
    expect(r.warnings.join(" ")).toMatch(/does not exist/);
  });
});

describe("Telegram details", () => {
  it("reads two-digit years and a headers-only paste", () => {
    const r = parse("Ana Costa, [14.10.26 09:12]\nsat off pls");
    expect(r.app).toBe("telegram");
    expect(r.dateOrder).toEqual({ value: "dmy", basis: "detected" });
    expect(r.messages[0]).toMatchObject({ author: "Ana Costa", text: "sat off pls", sentAt: "2026-10-14T08:12:00.000Z", line: 1 });
  });

  it("reads US-style headers with AM/PM", () => {
    const r = parse("Ana Costa, [10/14/2026 9:12 AM]\nsat off pls\n\nBen Moss, [10/14/2026 6:02 PM]\nhi");
    expect(r.dateOrder).toEqual({ value: "mdy", basis: "detected" });
    expect(r.clock).toBe("12h");
    expect(r.messages.map((m) => m.sentAt)).toEqual(["2026-10-14T08:12:00.000Z", "2026-10-14T17:02:00.000Z"]);
  });

  it("reads the one-line variant", () => {
    const r = parse("[14.10.2026 09:12] Ana Costa: sat off pls\n[14.10.2026 09:15] Ben Moss: can't do tues");
    expect(r.app).toBe("telegram");
    expect(r.messages.map((m) => [m.author, m.text, m.sentAt])).toEqual([
      ["Ana Costa", "sat off pls", "2026-10-14T08:12:00.000Z"],
      ["Ben Moss", "can't do tues", "2026-10-14T08:15:00.000Z"],
    ]);
  });

  it("keeps a comma inside the author name", () => {
    const r = parse("Costa, Ana, [14.10.2026 9:12]\nhi");
    expect(r.messages[0].author).toBe("Costa, Ana");
  });

  it("keeps paragraph breaks inside a message body", () => {
    const r = parse("Ana Costa, [14.10.2026 9:12]\nline one\n\nline two\n\nBen Moss, [14.10.2026 9:15]\nhi");
    expect(r.messages[0].text).toBe("line one\n\nline two");
    expect(r.messages[1].text).toBe("hi");
  });
});

describe("LINE details", () => {
  it("reads the other date-line styles", () => {
    const r = parse("2026.10.14 Wednesday\n09:12\tAna\tone\n\n2026/10/15\n10:01\tBen\ttwo");
    expect(r.app).toBe("line");
    expect(r.messages.map((m) => m.localDate)).toEqual(["2026-10-14", "2026-10-15"]);
  });

  it("unescapes doubled quotes and handles single-line quoted bodies", () => {
    const r = parse('2026/10/14(Wed)\n09:12\tAna\t"sat ""off"" pls"\n09:13\tBen\t"line one\nsaid ""no""\nline three"');
    expect(r.messages.map((m) => m.text)).toEqual(['sat "off" pls', 'line one\nsaid "no"\nline three']);
  });

  it("keeps a quote that never closes as written and carries on", () => {
    const r = parse('2026/10/14(Wed)\n09:12\tAna\t"unclosed\n09:13\tBen\tfine');
    expect(r.messages.map((m) => [m.author, m.text])).toEqual([
      ["Ana", '"unclosed'],
      ["Ben", "fine"],
    ]);
  });

  it("does not let a quoted body swallow later messages once the quote closes", () => {
    const r = parse('2026/10/14(Wed)\n09:12\tAna\t"a\nb"\n09:13\tBen\tc');
    expect(r.messages.map((m) => [m.line, m.text])).toEqual([
      [2, "a\nb"],
      [4, "c"],
    ]);
  });

  it("treats messages before the first date line as having no date", () => {
    const r = parse("09:12\tAna\tsat off\n2026/10/14(Wed)\n09:13\tBen\tok", { anchor: "2026-10-18T20:00:00.000Z" });
    expect(r.messages[0]).toMatchObject({ timestamp: "assumed", sentAt: "2026-10-18T20:00:00.000Z" });
    expect(r.messages[1]).toMatchObject({ timestamp: "parsed", sentAt: "2026-10-14T08:13:00.000Z" });
    expect(r.warnings.join(" ")).toMatch(/no date/);
  });

  it("reads a Japanese weekday in the date line", () => {
    const r = parse("2026/10/14(水)\n09:12\tAna\tsat off");
    expect(r.messages[0].localDate).toBe("2026-10-14");
  });
});

describe("plain fallback", () => {
  it("uses the anchor for every message and reads its local date and time", () => {
    const r = parse("Ana: sat off pls\nBen: ok", { anchor: "2026-10-26T21:04:00.000Z" });
    expect(r.app).toBe("plain");
    expect(r.clock).toBe("none");
    expect(r.messages.map((m) => [m.sentAt, m.localDate, m.localTime, m.timestamp])).toEqual([
      ["2026-10-26T21:04:00.000Z", "2026-10-26", "21:04", "assumed"],
      ["2026-10-26T21:04:00.000Z", "2026-10-26", "21:04", "assumed"],
    ]);
  });

  it("leaves everything null without an anchor", () => {
    const r = parse("Ana: sat off pls");
    expect(r.messages[0]).toMatchObject({ sentAt: null, localDate: null, localTime: null, timestamp: "assumed" });
  });

  it("ignores an invalid anchor with a warning", () => {
    const r = parse("Ana: sat off pls", { anchor: "yesterday-ish" });
    expect(r.messages[0].sentAt).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/anchor/);
  });

  it("accepts a full-width colon", () => {
    const r = parse("小明：周六休息\nAna: ok");
    expect(r.messages.map((m) => [m.author, m.text])).toEqual([
      ["小明", "周六休息"],
      ["Ana", "ok"],
    ]);
  });

  it("does not mistake URLs or times for authors", () => {
    const r = parse("Ana: see https://example.com/menu\nBen: at 9:30 sharp");
    expect(r.messages.map((m) => m.text)).toEqual(["see https://example.com/menu", "at 9:30 sharp"]);
  });
});

describe("empty and unrecognised input", () => {
  it("returns zero messages for an empty or blank paste", () => {
    for (const text of ["", "\n\n  \n", "﻿", "‎‎"]) {
      const r = parse(text);
      expect(r.messages).toEqual([]);
      expect(r.skipped).toEqual([]);
      expect(r.warnings).toEqual([]);
    }
  });

  it("explains when nothing is recognised", () => {
    const r = parse("hello there\nhow are you");
    expect(r.messages).toEqual([]);
    expect(r.skipped.map((s) => [s.line, s.reason])).toEqual([
      [1, "unparsed"],
      [2, "unparsed"],
    ]);
    expect(r.warnings.join(" ")).toMatch(/No chat messages were recognised/);
  });

  it("does not throw on non-string input", () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(() => preparseChat(bad as unknown as string, LONDON)).not.toThrow();
      expect(preparseChat(bad as unknown as string, LONDON).messages).toEqual([]);
    }
    expect(() => preparseChat("Ana: hi", undefined as unknown as { timezone: string })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// Fuzzing: never throw, and always return a well-formed result
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertWellFormed(r: PreparseResult, label: string) {
  expect(r.warnings.join("|"), label).not.toMatch(/Something went wrong/);
  let lastLine = 0;
  r.messages.forEach((m, i) => {
    expect(m.index, label).toBe(i);
    expect(m.line, label).toBeGreaterThan(lastLine);
    lastLine = m.line;
    expect(m.author, label).toBe(m.author.trim());
    expect(m.author, label).not.toBe("");
    expect(m.text, label).toBe(m.text.trim());
    expect(m.text, label).not.toBe("");
    if (m.sentAt !== null) expect(m.sentAt, label).toMatch(ISO_UTC);
    if (m.localDate !== null) expect(m.localDate, label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (m.localTime !== null) expect(m.localTime, label).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    expect(["parsed", "assumed"], label).toContain(m.timestamp);
    if (m.timestamp === "parsed") expect(m.sentAt, label).not.toBeNull();
  });
  let prev = 0;
  for (const s of r.skipped) {
    expect(s.line, label).toBeGreaterThanOrEqual(prev);
    prev = s.line;
    expect(["system", "media", "deleted", "header", "empty", "unparsed"], label).toContain(s.reason);
  }
  expect(["whatsapp-ios", "whatsapp-android", "whatsapp-web", "telegram", "line", "plain"]).toContain(r.app);
  expect(["dmy", "mdy", "ymd"]).toContain(r.dateOrder.value);
  expect(["24h", "12h", "none"]).toContain(r.clock);
}

describe("fuzz", () => {
  const POOL = [
    ..."abcXYZ ananas 0123456789",
    ..."[](),:.-/\\\"'<>!?*_",
    "\n", "\n", "\r\n", "\r", "\t", " ", " ",
    "‎", "‏", " ", " ", "﻿", "‪", "‬",
    "🙏", "🎸", "é", "水", "：", "–", "AM", "PM", "am", "pm",
    "14/10/2026", "10/14/26", "14.10.2026", "2026/10/14", "09:12", "9:12:40", "12:00 AM",
  ];

  const FRAGMENTS = [
    "[14/10/2026, 09:12:40] Ana: sat off pls",
    "[10/14/26, 9:12:40 AM] Ana: sat off pls",
    "14/10/2026, 09:12 - Ana: sat off pls",
    "10/14/26, 9:12 AM - Ana: sat off pls",
    "14/10/2026, 08:00 - Messages and calls are end-to-end encrypted.",
    "[09:12, 14/10/2026] Ana: sat off pls",
    "[9:12 AM, 10/14/2026] Ana: sat off pls",
    "Ana Costa, [14.10.2026 9:12]",
    "Ana Costa, [10/14/2026 9:12 AM]",
    "[14.10.2026 09:12] Ana Costa: sat off pls",
    "2026/10/14(Wed)",
    "2026.10.14 Wednesday",
    "Wed, 10/14/2026",
    "09:12\tAna\tsat off pls",
    '09:12\tAna\t"two',
    'lines"',
    "9:12 AM\tAna\tsat off pls",
    "09:15\tAna unsent a message.",
    "Ana joined the group.",
    "[LINE] Chat history in Corner Café",
    "Saved on: 2026/10/18, 22:00",
    "Ana: sat off pls",
    "‎[14/10/2026, 09:13:02] Ana: ‎image omitted",
    "<Media omitted>",
    "This message was deleted",
    "continuation line",
    "",
    "",
    "31/02/2026, 99:99 - Ana: nonsense",
    "[00/00/0000, 24:61:61] X: y",
    "Ana:",
    ": no author",
  ];

  const ZONES = ["Europe/London", "UTC", "Asia/Jakarta", "America/New_York", "Pacific/Auckland", "Not/AZone", ""];

  it("never throws on random strings", () => {
    const rnd = mulberry32(1234);
    for (let n = 0; n < 1500; n++) {
      const len = Math.floor(rnd() * 160);
      let s = "";
      for (let i = 0; i < len; i++) s += POOL[Math.floor(rnd() * POOL.length)];
      const zone = ZONES[Math.floor(rnd() * ZONES.length)];
      const r = preparseChat(s, { timezone: zone, defaultDateOrder: rnd() < 0.5 ? "mdy" : "dmy", anchor: rnd() < 0.5 ? "2026-10-18T20:00:00.000Z" : undefined });
      assertWellFormed(r, JSON.stringify(s));
    }
  });

  it("never throws on random mixes of the formats", () => {
    const rnd = mulberry32(98765);
    let totalMessages = 0;
    for (let n = 0; n < 1500; n++) {
      const count = 1 + Math.floor(rnd() * 14);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) parts.push(FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)]);
      const sep = ["\n", "\r\n", "\n\n", "\r"][Math.floor(rnd() * 4)];
      const s = parts.join(sep);
      const r = preparseChat(s, { timezone: ZONES[Math.floor(rnd() * ZONES.length)], anchor: rnd() < 0.5 ? "2026-10-18T20:00:00.000Z" : "garbage" });
      assertWellFormed(r, JSON.stringify(s));
      totalMessages += r.messages.length;
    }
    expect(totalMessages).toBeGreaterThan(1000); // the generator really does produce parseable chat
  });

  it("never throws on mangled real fixtures (shuffled lines, cuts, dropped characters)", () => {
    const rnd = mulberry32(555);
    const sources = CASES.map((c) => load(c.file));
    let totalMessages = 0;
    for (let n = 0; n < 600; n++) {
      const src = sources[Math.floor(rnd() * sources.length)];
      let lines = src.split("\n");
      if (rnd() < 0.5) lines = lines.sort(() => rnd() - 0.5);
      let s = lines.join("\n");
      s = s.slice(Math.floor(rnd() * 40), s.length - Math.floor(rnd() * 40));
      const chars = [...s];
      const drops = Math.floor(rnd() * 12);
      for (let d = 0; d < drops && chars.length > 0; d++) chars.splice(Math.floor(rnd() * chars.length), 1);
      const out = chars.join("");
      const r = parse(out, { anchor: "2026-10-18T20:00:00.000Z" });
      assertWellFormed(r, JSON.stringify(out.slice(0, 120)));
      totalMessages += r.messages.length;
    }
    expect(totalMessages).toBeGreaterThan(2000);
  });

  it("handles very long and degenerate lines without blowing up", () => {
    const nasty = [
      "[".repeat(50_000),
      ", [".repeat(20_000) + "]",
      "9".repeat(100_000),
      "1 ".repeat(50_000),
      " ".repeat(100_000) + "x",
      "a".repeat(100_000) + ": hi",
      '"'.repeat(30_000),
      "09:12\tAna\t" + '"'.repeat(30_000),
      Array.from({ length: 3000 }, () => '09:12\tAna\t"open').join("\n"),
      Array.from({ length: 3000 }, () => "invited ").join(""),
      "14/10/2026, 09:12 - " + "x: ".repeat(30_000),
    ];
    for (const s of nasty) {
      assertWellFormed(parse(s), s.slice(0, 40));
      expect(() => redactForModel(s)).not.toThrow();
    }
  }, 30_000);

  it("parses a few thousand messages", () => {
    const lines: string[] = [];
    for (let i = 0; i < 4000; i++) lines.push(`[14/10/2026, 09:${String(i % 60).padStart(2, "0")}:00] Ana: message ${i}`);
    const r = parse(lines.join("\n"));
    expect(r.messages).toHaveLength(4000);
    expect(r.messages[3999].text).toBe("message 3999");
  });
});

// ---------------------------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------------------------

describe("redactForModel", () => {
  const PHONES = [
    "07700 900123",
    "+44 7700 900123",
    "+44 (0)7700 900123",
    "+62 812-3456-7890",
    "0812-3456-7890",
    "081234567890",
    "(415) 555-0132",
    "415-555-0132",
    "415 555 0132",
    "+1 (415) 555-0132",
    "020 7946 0958",
    "44 7700 900123",
  ];

  it.each(PHONES)("masks the phone number %s", (phone) => {
    const r = redactForModel(`call me on ${phone} later`);
    expect(r.text).toBe("call me on [phone] later");
    expect(r.redactions).toEqual([{ kind: "phone", count: 1 }]);
  });

  it("masks emails", () => {
    const r = redactForModel("mail ana.costa+rota@cafe.co.uk or lou@example.com");
    expect(r.text).toBe("mail [email] or [email]");
    expect(r.redactions).toEqual([{ kind: "email", count: 2 }]);
  });

  it.each([
    "https://maps.google.com/?q=corner+cafe&z=12",
    "http://example.com",
    "www.cafe.com/menu",
    "maps.google.com/?q=cafe",
    "wa.me/447700900123",
    "bit.ly/3xYz",
  ])("masks the link %s", (link) => {
    const r = redactForModel(`see ${link} for details`);
    expect(r.text).toBe("see [link] for details");
    expect(r.redactions).toEqual([{ kind: "link", count: 1 }]);
  });

  it("counts each kind and orders them phone, email, link", () => {
    const r = redactForModel("Ana 07700 900123 / ana@x.com / https://x.com / 020 7946 0958 / https://y.com");
    expect(r.text).toBe("Ana [phone] / [email] / [link] / [phone] / [link]");
    expect(r.redactions).toEqual([
      { kind: "phone", count: 2 },
      { kind: "email", count: 1 },
      { kind: "link", count: 2 },
    ]);
  });

  it.each([
    "I'm in till 11, max 2 shifts",
    "can do 21:04 or 9:30",
    "14/10/2026",
    "14.10.2026",
    "2026-10-18",
    "14-10-2026",
    "05 10 2026",
    "2026-10-18T20:04:12.000Z",
    "10:00-18:00",
    "10:00 - 18:00",
    "9-5 mon to fri",
    "09:12:40",
    "£12.50 an hour",
    "3 people on sat",
    "12 - 15 - 18 - 20",
    "shifts 11 12 13",
    "Sat 17 Oct, 8 to 4",
  ])("leaves %s alone", (text) => {
    const r = redactForModel(text);
    expect(r.text).toBe(text);
    expect(r.redactions).toEqual([]);
  });

  it("does not touch a chat line's own timestamp", () => {
    const line = "[14/10/2026, 09:12:40] Ana: sat off pls, back by 21:04";
    expect(redactForModel(line).text).toBe(line);
  });

  it("handles empty and non-string input", () => {
    expect(redactForModel("")).toEqual({ text: "", redactions: [] });
    expect(redactForModel(undefined as unknown as string)).toEqual({ text: "", redactions: [] });
  });
});
