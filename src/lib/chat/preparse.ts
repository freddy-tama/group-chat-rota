import { DateTime } from "luxon";

// Deterministic chat pre-parser. A café manager pastes a copied/exported staff group chat and this
// turns the raw text into timestamped messages BEFORE any AI model sees it. Nothing here guesses
// meaning; it only recognises message boundaries, authors and clock times, and it never throws.
//
// Supported pastes (one format per paste, chosen by majority of matching header lines):
//   whatsapp-ios      [14/10/2026, 09:12:40] Ana: sat off pls      [10/14/26, 9:12:40 AM] Ana: ...
//   whatsapp-android  14/10/2026, 09:12 - Ana: sat off pls         10/14/26, 9:12 AM - Ana: ...
//   whatsapp-web      [09:12, 14/10/2026] Ana: sat off pls         [9:12 AM, 10/14/2026] Ana: ...
//   telegram          Ana Costa, [14.10.2026 9:12]  (body on the next lines)  or  [14.10.2026 09:12] Ana: text
//   line              2026/10/14(Wed)  then  09:12<TAB>Ana<TAB>sat off pls
//   plain             Ana: sat off pls   (no timestamps; the anchor stands in)

export type ChatApp = "whatsapp-ios" | "whatsapp-android" | "whatsapp-web" | "telegram" | "line" | "plain";
export type DateOrder = "dmy" | "mdy" | "ymd";

export interface ParsedMessage {
  /** 0-based order in the paste. */
  index: number;
  /** Trimmed display name as written ("Sam Lee"). */
  author: string;
  /** Message body; continuation lines joined with "\n"; trimmed. */
  text: string;
  /** UTC ISO instant ("2026-10-18T20:04:12.000Z"), null if no timestamp. */
  sentAt: string | null;
  /** "2026-10-18" in the given zone. */
  localDate: string | null;
  /** "21:04" (24 h) in the given zone. */
  localTime: string | null;
  /** "assumed" = no timestamp in the paste; sentAt = opts.anchor. */
  timestamp: "parsed" | "assumed";
  /** 1-based line where the message starts. */
  line: number;
}

export type SkipReason = "system" | "media" | "deleted" | "header" | "empty" | "unparsed";

export interface PreparseResult {
  app: ChatApp;
  dateOrder: { value: DateOrder; basis: "detected" | "assumed" | "not-applicable" };
  clock: "24h" | "12h" | "none";
  messages: ParsedMessage[];
  skipped: { line: number; reason: SkipReason; text: string }[];
  /** Human sentences, e.g. "Dates like 05/10 could be day/month or month/day; assumed day/month." */
  warnings: string[];
}

export interface PreparseOptions {
  timezone: string;
  defaultDateOrder?: "dmy" | "mdy";
  anchor?: string;
}

// ---------------------------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------------------------

/** BOM, LRM/RLM and bidi embedding/isolate marks go; narrow/no-break/figure/thin spaces become plain spaces. */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[‎‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[    ]/g, " ");
}

function clip(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function trimStartSpaces(s: string): string {
  return s.replace(/^[ \t]+/, "");
}

// ---------------------------------------------------------------------------------------------
// Date and time tokens
// ---------------------------------------------------------------------------------------------

interface TimeTuple {
  h: number;
  m: number;
  s: number;
  ampm: "am" | "pm" | null;
}

/**
 * "ymd": 2026/10/14.  "dotted": 14.10.26 (always day first).  "slash": 14/10/26 or 10/14/26 or 14-10-26
 * (day-first or month-first, decided across the whole paste). p1/p2 are the first two numeric fields
 * as written; for ymd p1 = year, p2 = month, p3 = day.
 */
interface DateTuple {
  kind: "ymd" | "dotted" | "slash";
  p1: number;
  p2: number;
  p3: number;
  year: number;
  raw: string;
  sep: string;
  weekday: number | null; // 1 = Monday ... 7 = Sunday, from a LINE date line
}

// Date token: yyyy/m/d or d/m/yy(yy). "/", "." and "-" separate fields. Non-capturing on purpose.
const DATE_SRC = "(?:\\d{4}[/.\\-]\\d{1,2}[/.\\-]\\d{1,2}|\\d{1,2}[/.\\-]\\d{1,2}[/.\\-](?:\\d{4}|\\d{2}))";
// Time token: 9:12, 09:12:40, 9:12 AM, 9.12 (some Android locales), 9:12 p. m.
const TIME_SRC = "\\d{1,2}[:.]\\d{2}(?:[:.]\\d{2})?(?:\\s?[AaPp]\\.?\\s?[Mm]\\.?)?";

function parseTime(raw: string): TimeTuple | null {
  const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s?([AaPp])\.?\s?[Mm]\.?)?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const minute = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  const ampm = m[4] ? (m[4].toLowerCase() === "p" ? "pm" : "am") : null;
  if (minute > 59 || s > 59) return null;
  if (ampm ? h > 12 : h > 23) return null;
  return { h, m: minute, s, ampm };
}

function to24(t: TimeTuple): number {
  if (t.ampm === "pm") return (t.h % 12) + 12;
  if (t.ampm === "am") return t.h % 12;
  return t.h;
}

function parseDate(raw: string, weekday: number | null = null): DateTuple | null {
  const m = /^(\d{1,4})([/.\-])(\d{1,2})\2(\d{1,4})$/.exec(raw.trim());
  if (!m) return null;
  const [, a, sep, b, c] = m;
  const p1 = Number(a);
  const p2 = Number(b);
  const p3 = Number(c);
  if (a.length === 4 && c.length <= 2) {
    return { kind: "ymd", p1, p2, p3, year: p1, raw: m[0], sep, weekday };
  }
  if (a.length <= 2 && (c.length === 2 || c.length === 4)) {
    const year = c.length === 2 ? 2000 + p3 : p3;
    return { kind: sep === "." ? "dotted" : "slash", p1, p2, p3, year, raw: m[0], sep, weekday };
  }
  return null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function validYmd(v: Ymd): boolean {
  return v.y >= 2000 && v.y <= 2099 && v.m >= 1 && v.m <= 12 && v.d >= 1 && v.d <= daysInMonth(v.y, v.m);
}

/** Strict reading of a tuple in one order, or null if it is not a real calendar date that way. */
function readDate(t: DateTuple, order: "dmy" | "mdy"): Ymd | null {
  let v: Ymd;
  if (t.kind === "ymd") v = { y: t.p1, m: t.p2, d: t.p3 };
  else if (order === "mdy" && t.kind !== "dotted") v = { y: t.year, m: t.p1, d: t.p2 };
  else v = { y: t.year, m: t.p2, d: t.p1 };
  return validYmd(v) ? v : null;
}

/** The chosen order first; if that is not a real date, the other order (mixed or odd pastes). */
function resolveDate(t: DateTuple, order: "dmy" | "mdy"): Ymd | null {
  const first = readDate(t, order);
  if (first || t.kind !== "slash") return first;
  return readDate(t, order === "dmy" ? "mdy" : "dmy");
}

function weekdayOfYmd(v: Ymd): number {
  return DateTime.utc(v.y, v.m, v.d).weekday;
}

// ---------------------------------------------------------------------------------------------
// Header matching (one regex family per app)
// ---------------------------------------------------------------------------------------------

type TimestampFormat = "ios" | "android" | "web" | "telegram" | "line";
type Format = TimestampFormat | "plain";

const APP_BY_FORMAT: Record<Format, ChatApp> = {
  ios: "whatsapp-ios",
  android: "whatsapp-android",
  web: "whatsapp-web",
  telegram: "telegram",
  line: "line",
  plain: "plain",
};

const TIMESTAMP_PRIORITY: TimestampFormat[] = ["ios", "android", "web", "telegram", "line"];

// [14/10/2026, 09:12:40] Ana: text   (the comma is what tells iOS from Telegram's one-line form)
const RE_IOS = new RegExp(`^\\[(${DATE_SRC}),\\s*(${TIME_SRC})\\]\\s?(.*)$`);
// 14/10/2026, 09:12 - Ana: text      (hyphen may be an en or em dash in some locales)
const RE_ANDROID = new RegExp(`^(${DATE_SRC}),?\\s+(${TIME_SRC})\\s+[-\\u2013\\u2014](?:\\s+(.*))?$`);
// [09:12, 14/10/2026] Ana: text
const RE_WEB = new RegExp(`^\\[(${TIME_SRC}),?\\s+(${DATE_SRC})\\]\\s?(.*)$`);
// Ana Costa, [14.10.2026 9:12]       (body follows on the next lines)
const RE_TG_HEAD = new RegExp(`^(.{1,120}?),\\s*\\[(${DATE_SRC})[,\\s]+(${TIME_SRC})\\]\\s*$`);
// [14.10.2026 09:12] Ana Costa: text
const RE_TG_LINE = new RegExp(`^\\[(${DATE_SRC})\\s+(${TIME_SRC})\\]\\s?(.*)$`);
// 09:12<TAB>Ana<TAB>text
const RE_LINE_MSG = new RegExp(`^(${TIME_SRC})\\t(.*)$`);
// 2026/10/14(Wed)   2026.10.14 Wednesday   2026/10/14
const RE_LINE_DATE_A = new RegExp(`^(${DATE_SRC})(?:\\s*[(\\uFF08]([^)\\uFF09]{1,14})[)\\uFF09]|\\s+([A-Za-z]{3,12})\\.?)?$`);
// Wed, 10/14/2026
const RE_LINE_DATE_B = new RegExp(`^([A-Za-z]{3,12})\\.?,?\\s+(${DATE_SRC})$`);
const RE_LINE_HEADER = /^(?:\[LINE\]|Chat history (?:in|with|of|for)\b|Saved on\s*:)/i;

type Hit =
  | { type: "rest"; date: DateTuple; time: TimeTuple; rest: string }
  | { type: "author"; date: DateTuple | null; time: TimeTuple | null; author: string; text: string };

function restHit(dateRaw: string, timeRaw: string, rest: string | undefined): Hit | null {
  const date = parseDate(dateRaw);
  const time = parseTime(timeRaw);
  if (!date || !time) return null;
  return { type: "rest", date, time, rest: rest ?? "" };
}

function matchHeader(format: TimestampFormat, line: string): Hit | null {
  if (line.length === 0) return null;
  let m: RegExpExecArray | null;
  switch (format) {
    case "ios":
      m = RE_IOS.exec(line);
      return m ? restHit(m[1], m[2], m[3]) : null;
    case "android":
      m = RE_ANDROID.exec(line);
      return m ? restHit(m[1], m[2], m[3]) : null;
    case "web":
      m = RE_WEB.exec(line);
      return m ? restHit(m[2], m[1], m[3]) : null;
    case "telegram": {
      const trimmed = line.trimEnd();
      if (trimmed.endsWith("]")) {
        m = RE_TG_HEAD.exec(trimmed);
        if (m) {
          const date = parseDate(m[2]);
          const time = parseTime(m[3]);
          const author = m[1].trim();
          if (date && time && author) return { type: "author", date, time, author, text: "" };
        }
      }
      m = RE_TG_LINE.exec(line);
      return m ? restHit(m[1], m[2], m[3]) : null;
    }
    default:
      return null;
  }
}

function plausibleName(name: string): boolean {
  if (name.length === 0 || name.length > 32) return false;
  if (name.split(/\s+/).length > 5) return false;
  return /[\p{L}\p{Extended_Pictographic}]/u.test(name);
}

/** "Ana: sat off pls" with no timestamp. A half-width colon must be followed by a space (not "http://"). */
function matchPlain(line: string): Hit | null {
  const m = /[:：]/.exec(line);
  if (!m || m.index < 1 || m.index > 40) return null;
  const after = line.slice(m.index + 1);
  if (m[0] === ":" && after !== "" && !/^\s/.test(after)) return null;
  const author = line.slice(0, m.index).trim();
  if (!plausibleName(author)) return null;
  return { type: "author", date: null, time: null, author, text: after.trim() };
}

function weekdayFromToken(token: string | undefined): number | null {
  const t = token ? token.trim() : "";
  if (t === "") return null;
  const kanji = "月火水木金土日".indexOf(t[0]);
  if (kanji >= 0 && (t.length === 1 || /^曜日?$/.test(t.slice(1)))) return kanji + 1;
  const m = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$/i.exec(t);
  if (!m) return null;
  return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(m[1].toLowerCase()) + 1;
}

function matchLineDate(line: string): DateTuple | null {
  let m = RE_LINE_DATE_A.exec(line);
  if (m) return parseDate(m[1], weekdayFromToken(m[2] ?? m[3]));
  m = RE_LINE_DATE_B.exec(line);
  if (m) return parseDate(m[2], weekdayFromToken(m[1]));
  return null;
}

function matchLineMessage(line: string): { time: TimeTuple; rest: string } | null {
  const m = RE_LINE_MSG.exec(trimStartSpaces(line));
  if (!m) return null;
  const time = parseTime(m[1]);
  return time ? { time, rest: m[2] } : null;
}

// ---------------------------------------------------------------------------------------------
// Classifying what follows a timestamp
// ---------------------------------------------------------------------------------------------

const MAX_AUTHOR = 60;

const MEDIA_RES: RegExp[] = [
  /^<media omitted>$/i,
  /^<attached:[^>]*>$/i,
  /^(?:image|video|audio|sticker|gif|document|contact card|voice message|voice note|live location|location)\s+omitted\.?$/i,
  /^.{1,160}\(file attached\)$/i,
  /^\[(?:photos?|images?|stickers?|videos?|voice messages?|audio|files?|albums?|locations?|contacts?|gifs?)\]$/i,
];

const DELETED_RES: RegExp[] = [
  /^(?:🚫\s*)?(?:this message was deleted(?: by .{1,60})?|you deleted this message)\.?$/i,
  /^.{1,60} unsent a message\.?$/i,
];

// Authored lines whose body is really a system notice (iOS puts the group name in the author slot).
const SYSTEM_BODY_RES: RegExp[] = [
  /^messages and calls are end-to-end encrypted\b/i,
  /^added you\.?$/i,
  /^you were added\.?$/i,
  /^joined using (?:this group['’]s invite link|a group link|a group invite link)\.?$/i,
  /^changed (?:this group['’]s|the group) (?:icon|description|name|settings)\b/i,
  /^created (?:this )?group\b/i,
];

// A "name" that is really a system sentence containing a colon: Lou changed the subject from "Cafe: Crew" ...
const SYSTEM_AUTHOR_RE =
  /\s(?:changed (?:the|this) (?:group|subject)|changed their phone number|joined using|created group)(?:\s|$)/i;

const LINE_SYSTEM_RE =
  /\b(?:joined|left) the (?:group|chat)\b|\binvited\b.{1,80}\bto the (?:group|chat)\b|\bwas removed from the (?:group|chat)\b|\bremoved\b.{1,80}\bfrom the (?:group|chat)\b|\bchanged the (?:group|chat) (?:name|photo|image|icon|settings)\b|\bcreated the (?:group|chat)\b|\bunsent a message\b/i;

const EDITED_MARK = "<this message was edited>";

function matchesAny(res: RegExp[], text: string): boolean {
  return res.some((re) => re.test(text));
}

function bareReason(text: string): SkipReason {
  if (matchesAny(DELETED_RES, text)) return "deleted";
  if (matchesAny(MEDIA_RES, text)) return "media";
  return "system";
}

type Classified = { kind: "msg"; author: string; text: string } | { kind: "skip"; reason: SkipReason };

/** Splits "Ana: sat off pls" from a system sentence ("You added Jo", "Messages and calls are ..."). */
function classifyRest(rest: string): Classified {
  const r = rest.trim();
  if (r === "") return { kind: "skip", reason: "empty" };
  const limit = Math.min(r.length, MAX_AUTHOR + 1);
  for (let i = 0; i < limit; i++) {
    if (r[i] === ":" && (i === r.length - 1 || /\s/.test(r[i + 1]))) {
      const author = r.slice(0, i).trim();
      if (author !== "" && !SYSTEM_AUTHOR_RE.test(` ${author} `)) {
        return { kind: "msg", author, text: r.slice(i + 1) };
      }
      break;
    }
  }
  return { kind: "skip", reason: bareReason(r) };
}

// ---------------------------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------------------------

function isLineFormatLine(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return false;
  return RE_LINE_HEADER.test(trimmed) || matchLineDate(trimmed) !== null || matchLineMessage(raw) !== null;
}

function detectFormat(lines: string[]): Format {
  const counts: Record<Format, number> = { ios: 0, android: 0, web: 0, telegram: 0, line: 0, plain: 0 };
  for (const raw of lines) {
    const line = trimStartSpaces(raw);
    if (line === "") continue;
    for (const f of ["ios", "android", "web", "telegram"] as const) {
      if (matchHeader(f, line)) {
        counts[f]++;
        break;
      }
    }
    if (isLineFormatLine(raw)) counts.line++;
    if (matchPlain(line)) counts.plain++;
  }
  let best: TimestampFormat | null = null;
  for (const f of TIMESTAMP_PRIORITY) {
    if (counts[f] > 0 && (best === null || counts[f] > counts[best])) best = f;
  }
  if (best === null) return "plain";
  return counts.plain > counts[best] ? "plain" : best;
}

// ---------------------------------------------------------------------------------------------
// Pass 1: split into drafts (one per message or skipped item)
// ---------------------------------------------------------------------------------------------

interface Draft {
  kind: "msg" | "skip";
  line: number;
  author: string;
  reason: SkipReason;
  body: string[];
  raw: string[];
  date: DateTuple | null;
  time: TimeTuple | null;
}

function newDraft(line: number, raw: string, date: DateTuple | null, time: TimeTuple | null): Draft {
  return { kind: "msg", line, author: "", reason: "system", body: [], raw: [raw], date, time };
}

function draftFromHit(hit: Hit, lineNo: number, raw: string): Draft {
  const d = newDraft(lineNo, raw, hit.date, hit.time);
  if (hit.type === "author") {
    d.author = hit.author;
    if (hit.text !== "") d.body.push(hit.text);
    return d;
  }
  const c = classifyRest(hit.rest);
  if (c.kind === "msg") {
    d.author = c.author;
    d.body.push(c.text);
  } else {
    d.kind = "skip";
    d.reason = c.reason;
  }
  return d;
}

/**
 * LINE wraps a multi-line body in double quotes, with "" for a literal quote. Returns the unquoted body
 * lines and the index of the line holding the closing quote, or null when the quote never properly closes
 * (then the text is kept as written).
 */
function scanQuotedBody(lines: string[], start: number, firstBody: string): { last: number; body: string[] } | null {
  const MAX_LOOKAHEAD = 300;
  const out: string[] = [];
  let seg = firstBody.slice(1);
  for (let k = start; k < lines.length && k <= start + MAX_LOOKAHEAD; k++) {
    if (k > start) seg = lines[k];
    let buf = "";
    for (let p = 0; p < seg.length; p++) {
      const ch = seg[p];
      if (ch === '"') {
        if (seg[p + 1] === '"') {
          buf += '"';
          p++;
          continue;
        }
        if (seg.slice(p + 1).trim() !== "") return null;
        out.push(buf);
        return { last: k, body: out };
      }
      buf += ch;
    }
    out.push(buf);
  }
  return null;
}

interface Pass1 {
  drafts: Draft[];
  skipped: PreparseResult["skipped"];
  tuples: DateTuple[];
  anyTime: boolean;
  anyAmPm: boolean;
}

function pass1(lines: string[], format: Format): Pass1 {
  const drafts: Draft[] = [];
  const skipped: PreparseResult["skipped"] = [];
  const tuples: DateTuple[] = [];
  const seen = new Set<string>();
  let anyTime = false;
  let anyAmPm = false;
  let current: Draft | null = null;
  let lineDate: DateTuple | null = null;

  const flush = () => {
    if (current) drafts.push(current);
    current = null;
  };
  const noteDate = (d: DateTuple | null) => {
    if (!d) return;
    const key = `${d.kind}|${d.raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    tuples.push(d);
  };
  const noteTime = (t: TimeTuple | null) => {
    if (!t) return;
    anyTime = true;
    if (t.ampm) anyAmPm = true;
  };
  const continueOrUnparsed = (raw: string, lineNo: number) => {
    if (current) {
      current.raw.push(raw);
      if (current.kind === "msg") current.body.push(raw);
    } else if (raw.trim() !== "") {
      skipped.push({ line: lineNo, reason: "unparsed", text: clip(raw.trim()) });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;

    if (format === "line") {
      const trimmed = raw.trim();
      if (trimmed === "") continue; // multi-line LINE bodies are quoted, so a bare blank line is just a gap
      if (RE_LINE_HEADER.test(trimmed)) {
        flush();
        skipped.push({ line: lineNo, reason: "header", text: clip(trimmed) });
        continue;
      }
      const dateLine = matchLineDate(trimmed);
      if (dateLine) {
        flush();
        lineDate = dateLine;
        noteDate(dateLine);
        continue;
      }
      const msg = matchLineMessage(raw);
      if (msg) {
        flush();
        noteTime(msg.time);
        const tab = msg.rest.indexOf("\t");
        if (tab < 0) {
          const d = newDraft(lineNo, raw, lineDate, msg.time);
          d.kind = "skip";
          d.reason = bareReason(msg.rest.trim());
          current = d;
        } else {
          const d = newDraft(lineNo, raw, lineDate, msg.time);
          d.author = msg.rest.slice(0, tab).trim();
          if (d.author === "") {
            d.kind = "skip";
            d.reason = "unparsed";
          }
          const body = msg.rest.slice(tab + 1);
          const quoted = body.startsWith('"') ? scanQuotedBody(lines, i, body) : null;
          if (quoted) {
            d.body = quoted.body;
            d.raw = lines.slice(i, quoted.last + 1);
            i = quoted.last;
          } else {
            d.body = [body];
          }
          current = d;
        }
        continue;
      }
      if (LINE_SYSTEM_RE.test(trimmed)) {
        flush();
        skipped.push({ line: lineNo, reason: "system", text: clip(trimmed) });
        continue;
      }
      continueOrUnparsed(raw, lineNo);
      continue;
    }

    const probe = trimStartSpaces(raw);
    const hit = format === "plain" ? matchPlain(probe) : matchHeader(format, probe);
    if (hit) {
      flush();
      noteDate(hit.date);
      noteTime(hit.time);
      current = draftFromHit(hit, lineNo, raw);
      continue;
    }
    continueOrUnparsed(raw, lineNo);
  }
  flush();
  return { drafts, skipped, tuples, anyTime, anyAmPm };
}

// ---------------------------------------------------------------------------------------------
// Pass 2: settle each draft (message vs skipped), then work out the date order and timestamps
// ---------------------------------------------------------------------------------------------

interface Settled {
  draft: Draft;
  text: string;
}

function cleanBody(body: string[]): string {
  const text = body
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
  return text.toLowerCase().endsWith(EDITED_MARK) ? text.slice(0, text.length - EDITED_MARK.length).trimEnd() : text;
}

/** Media-only, deleted and system bodies are skipped; a media marker followed by a caption keeps the caption. */
function settleBody(text: string): { text: string } | { reason: SkipReason } {
  if (matchesAny(DELETED_RES, text)) return { reason: "deleted" };
  if (matchesAny(SYSTEM_BODY_RES, text)) return { reason: "system" };
  const nl = text.indexOf("\n");
  const first = (nl < 0 ? text : text.slice(0, nl)).trim();
  if (matchesAny(MEDIA_RES, first)) {
    const caption = nl < 0 ? "" : text.slice(nl + 1).trim();
    return caption === "" ? { reason: "media" } : { text: caption };
  }
  return { text };
}

interface OrderDecision {
  value: DateOrder;
  basis: "detected" | "assumed" | "not-applicable";
}

function decideDateOrder(
  tuples: DateTuple[],
  fallback: "dmy" | "mdy",
  warnings: string[],
): OrderDecision {
  const slash = tuples.filter((t) => t.kind === "slash");
  if (slash.length > 0) {
    const dmyEvidence = slash.filter((t) => t.p1 > 12 && t.p1 <= 31 && t.p2 >= 1 && t.p2 <= 12);
    const mdyEvidence = slash.filter((t) => t.p2 > 12 && t.p2 <= 31 && t.p1 >= 1 && t.p1 <= 12);
    if (dmyEvidence.length > 0 && mdyEvidence.length > 0) {
      warnings.push(
        `Dates in this paste mix day/month and month/day order (for example ${dmyEvidence[0].raw} and ${mdyEvidence[0].raw}); assumed day/month.`,
      );
      return { value: "dmy", basis: "assumed" };
    }
    if (dmyEvidence.length > 0) return { value: "dmy", basis: "detected" };
    if (mdyEvidence.length > 0) return { value: "mdy", basis: "detected" };

    // LINE date lines carry a weekday, which settles 05/10/2026 vs 10/05/2026 on its own.
    let dmyVotes = 0;
    let mdyVotes = 0;
    for (const t of slash) {
      if (t.weekday === null) continue;
      const asDmy = readDate(t, "dmy");
      const asMdy = readDate(t, "mdy");
      const dmyOk = asDmy !== null && weekdayOfYmd(asDmy) === t.weekday;
      const mdyOk = asMdy !== null && weekdayOfYmd(asMdy) === t.weekday;
      if (dmyOk && !mdyOk) dmyVotes++;
      else if (mdyOk && !dmyOk) mdyVotes++;
    }
    if (dmyVotes > 0 && mdyVotes === 0) return { value: "dmy", basis: "detected" };
    if (mdyVotes > 0 && dmyVotes === 0) return { value: "mdy", basis: "detected" };

    const example = slash.find((t) => t.p1 !== t.p2 && t.p1 <= 12 && t.p2 <= 12) ?? slash[0];
    const shown = example.raw.split(example.sep).slice(0, 2).join(example.sep);
    warnings.push(
      `Dates like ${shown} could be day/month or month/day; assumed ${fallback === "mdy" ? "month/day" : "day/month"}.`,
    );
    return { value: fallback, basis: "assumed" };
  }
  if (tuples.some((t) => t.kind === "dotted")) return { value: "dmy", basis: "detected" };
  if (tuples.some((t) => t.kind === "ymd")) return { value: "ymd", basis: "detected" };
  return { value: fallback, basis: "not-applicable" };
}

function resolveZone(timezone: unknown, warnings: string[]): string {
  if (typeof timezone === "string" && timezone.trim() !== "" && DateTime.now().setZone(timezone).isValid) {
    return timezone;
  }
  warnings.push(`The time zone "${String(timezone)}" was not recognised; used UTC instead.`);
  return "UTC";
}

interface LocalStamp {
  sentAt: string;
  localDate: string;
  localTime: string;
}

function stampOf(dt: DateTime): LocalStamp | null {
  if (!dt.isValid) return null;
  const sentAt = dt.toUTC().toISO();
  const localDate = dt.toISODate();
  if (!sentAt || !localDate) return null;
  return { sentAt, localDate, localTime: dt.toFormat("HH:mm") };
}

function resolveAnchor(anchor: unknown, zone: string, warnings: string[]): LocalStamp | null {
  if (anchor === undefined || anchor === null || anchor === "") return null;
  const dt = typeof anchor === "string" ? DateTime.fromISO(anchor, { zone: "UTC" }) : DateTime.invalid("anchor");
  const stamp = dt.isValid ? stampOf(dt.setZone(zone)) : null;
  if (!stamp) warnings.push("The anchor time was not a valid date and time; it was ignored.");
  return stamp;
}

function emptyResult(fallback: "dmy" | "mdy", warnings: string[]): PreparseResult {
  return {
    app: "plain",
    dateOrder: { value: fallback, basis: "not-applicable" },
    clock: "none",
    messages: [],
    skipped: [],
    warnings,
  };
}

function run(input: unknown, opts: Partial<PreparseOptions> | undefined): PreparseResult {
  const warnings: string[] = [];
  const text = typeof input === "string" ? input : "";
  const fallbackOrder: "dmy" | "mdy" = opts?.defaultDateOrder === "mdy" ? "mdy" : "dmy";
  const zone = resolveZone(opts?.timezone, warnings);
  const anchor = resolveAnchor(opts?.anchor, zone, warnings);

  const lines = normalize(text).split("\n");
  if (lines.every((l) => l.trim() === "")) return emptyResult(fallbackOrder, []);

  const format = detectFormat(lines);
  const p1 = pass1(lines, format);

  const skipped = [...p1.skipped];
  const settled: Settled[] = [];
  for (const d of p1.drafts) {
    if (d.kind === "skip") {
      skipped.push({ line: d.line, reason: d.reason, text: clip(d.raw.join("\n").trim()) });
      continue;
    }
    const cleaned = cleanBody(d.body);
    if (cleaned === "") {
      skipped.push({ line: d.line, reason: "empty", text: clip(d.raw.join("\n").trim()) });
      continue;
    }
    const verdict = settleBody(cleaned);
    if ("reason" in verdict) {
      skipped.push({ line: d.line, reason: verdict.reason, text: clip(d.raw.join("\n").trim()) });
      continue;
    }
    settled.push({ draft: d, text: verdict.text });
  }
  skipped.sort((a, b) => a.line - b.line);

  const dateOrder = decideDateOrder(p1.tuples, fallbackOrder, warnings);
  const readOrder: "dmy" | "mdy" = dateOrder.value === "mdy" ? "mdy" : "dmy";

  let undated = 0;
  let impossible = 0;
  const messages: ParsedMessage[] = settled.map(({ draft, text: body }, index) => {
    let stamp: LocalStamp | null = null;
    if (draft.date && draft.time) {
      const ymd = resolveDate(draft.date, readOrder);
      if (ymd) {
        stamp = stampOf(
          DateTime.fromObject(
            { year: ymd.y, month: ymd.m, day: ymd.d, hour: to24(draft.time), minute: draft.time.m, second: draft.time.s },
            { zone },
          ),
        );
      }
      if (!stamp) impossible++;
    } else if (format !== "plain") {
      undated++;
    }
    return {
      index,
      author: draft.author,
      text: body,
      sentAt: stamp ? stamp.sentAt : anchor ? anchor.sentAt : null,
      localDate: stamp ? stamp.localDate : anchor ? anchor.localDate : null,
      localTime: stamp ? stamp.localTime : anchor ? anchor.localTime : null,
      timestamp: stamp ? "parsed" : "assumed",
      line: draft.line,
    };
  });

  if (format === "plain" && messages.length > 0) {
    warnings.push(
      "No dates or times were found in this paste, so every message is treated as sent at the time you pasted it; words like \"tomorrow\" cannot be placed on the calendar.",
    );
  }
  if (undated > 0) {
    warnings.push(
      `${undated} message${undated === 1 ? " has" : "s have"} a time but no date (the paste starts before the first date line), so ${undated === 1 ? "it was" : "they were"} treated as sent at the time you pasted it.`,
    );
  }
  if (impossible > 0) {
    warnings.push(
      `${impossible} message${impossible === 1 ? " has" : "s have"} a date that does not exist on the calendar, so ${impossible === 1 ? "it was" : "they were"} treated as sent at the time you pasted it.`,
    );
  }
  if (messages.length === 0) {
    warnings.push(
      "No chat messages were recognised in this paste. Paste the chat as exported or copied from WhatsApp, Telegram or LINE, or as plain lines like \"Ana: sat off pls\".",
    );
  }

  return {
    app: APP_BY_FORMAT[format],
    dateOrder,
    clock: p1.anyAmPm ? "12h" : p1.anyTime ? "24h" : "none",
    messages,
    skipped,
    warnings,
  };
}

/**
 * Turns a pasted group chat into timestamped messages. Timestamps are local wall time in `opts.timezone`
 * and are converted to UTC with luxon (DST-correct). Never throws, whatever the input.
 */
export function preparseChat(text: string, opts: PreparseOptions): PreparseResult {
  try {
    return run(text, opts);
  } catch {
    return emptyResult(opts?.defaultDateOrder === "mdy" ? "mdy" : "dmy", [
      "Something went wrong while reading this paste, so no messages were extracted.",
    ]);
  }
}

// ---------------------------------------------------------------------------------------------
// Redaction before text goes to a model
// ---------------------------------------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}/g;
const LINK_RE = new RegExp(
  [
    "(?:https?:\\/\\/|www\\.)[^\\s<>\"'\\])]+",
    "(?:wa\\.me|t\\.me|youtu\\.be|bit\\.ly|goo\\.gl|maps\\.app\\.goo\\.gl)\\/[^\\s<>\"'\\])]*",
    "\\b(?:[a-z0-9-]{1,63}\\.){1,5}(?:com|net|org|io|app|dev|link|xyz|info|co\\.uk|co\\.id)\\b(?:\\/[^\\s<>\"'\\])]*)?",
  ].join("|"),
  "gi",
);
// A run of digits with spaces, dashes and parentheses between them, optionally led by "+" or "(".
const PHONE_CANDIDATE_RE = new RegExp("(?<![\\w/.:-])[+(]?\\d[\\d ()\\t-]{6,30}\\d(?![\\w:])", "g");

function looksLikeDate(candidate: string): boolean {
  const c = candidate.trim();
  return /^\d{4}[ -]\d{1,2}[ -]\d{1,2}$/.test(c) || /^\d{1,2}[ -]\d{1,2}[ -](?:\d{4}|\d{2})$/.test(c);
}

function looksLikePhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 19) return false;
  if (looksLikeDate(candidate)) return false;
  const c = candidate.trim();
  if (c.startsWith("+") || c.startsWith("(")) return true;
  if (c.startsWith("0")) return true;
  const groups = c.split(/[^\d]+/).filter(Boolean);
  if (groups.some((g) => g.length >= 8)) return true; // one unbroken run: 4155550132
  if (/^\d{3}[ -]\d{3}[ -]\d{4}$/.test(c)) return true; // US 415 555 0132
  return digits.length >= 10 && groups.some((g) => g.length >= 4); // 44 7700 900123
}

/**
 * Masks phone numbers, emails and links before text is sent to a model. Times ("21:04"), dates
 * ("14/10/2026") and small numbers ("max 2 shifts", "till 11") are left alone.
 */
export function redactForModel(text: string): {
  text: string;
  redactions: { kind: "phone" | "email" | "link"; count: number }[];
} {
  const counts = { phone: 0, email: 0, link: 0 };
  let out = typeof text === "string" ? text : "";
  out = out.replace(EMAIL_RE, () => {
    counts.email++;
    return "[email]";
  });
  out = out.replace(LINK_RE, () => {
    counts.link++;
    return "[link]";
  });
  out = out.replace(PHONE_CANDIDATE_RE, (match) => {
    if (!looksLikePhone(match)) return match;
    counts.phone++;
    return "[phone]";
  });
  const redactions = (["phone", "email", "link"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => ({ kind, count: counts[kind] }));
  return { text: out, redactions };
}
