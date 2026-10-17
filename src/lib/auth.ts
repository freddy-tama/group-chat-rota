import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { appConfig, shareLinks, weeks } from "./db/schema";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = "gcr_session";
const TOKEN_TTL = "7d";

export type Principal =
  | { kind: "user"; userId: string; isDemo: boolean }
  | { kind: "staff"; shareLinkId: string; staffId: string; weekId: string; workspaceId: string };

// ---- passwords -------------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---- signing secret --------------------------------------------------------------------------
// AUTH_SECRET wins when set. Otherwise a random secret is generated once and kept in the database,
// so a fresh deployment works without extra configuration and every preview shares it.

const secretCache = new WeakMap<object, Uint8Array>();

async function signingKey(db: Db): Promise<Uint8Array> {
  if (process.env.AUTH_SECRET) return new TextEncoder().encode(process.env.AUTH_SECRET);
  const cached = secretCache.get(db);
  if (cached) return cached;
  const fresh = randomBytes(32).toString("base64url");
  await db.insert(appConfig).values({ key: "jwt_secret", value: fresh }).onConflictDoNothing();
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, "jwt_secret"));
  const key = new TextEncoder().encode(row.value);
  secretCache.set(db, key);
  return key;
}

export async function issueToken(db: Db, userId: string, isDemo: boolean): Promise<string> {
  return new SignJWT({ demo: isDemo })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("group-chat-rota")
    .setExpirationTime(TOKEN_TTL)
    .sign(await signingKey(db));
}

async function verifyToken(db: Db, token: string): Promise<Principal | null> {
  try {
    const { payload } = await jwtVerify(token, await signingKey(db), { issuer: "group-chat-rota", algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { kind: "user", userId: payload.sub, isDemo: payload.demo === true };
  } catch {
    return null;
  }
}

// ---- share links -----------------------------------------------------------------------------
// A share link gives one staff member read-only access to their own shifts in one published week.

export function newShareToken(): { token: string; hash: string } {
  const token = `shr_${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashShareToken(token) };
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function resolveShareToken(db: Db, token: string): Promise<Principal | null> {
  const [row] = await db
    .select({ id: shareLinks.id, staffId: shareLinks.staffId, weekId: shareLinks.weekId, workspaceId: weeks.workspaceId })
    .from(shareLinks)
    .innerJoin(weeks, eq(weeks.id, shareLinks.weekId))
    .where(eq(shareLinks.tokenHash, hashShareToken(token)));
  if (!row) return null;
  return { kind: "staff", shareLinkId: row.id, staffId: row.staffId, weekId: row.weekId, workspaceId: row.workspaceId };
}

// ---- request principal -----------------------------------------------------------------------

export function bearerFrom(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || null;
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("=")) || null;
  }
  return null;
}

export async function principalFrom(db: Db, req: Request): Promise<Principal | null> {
  const token = bearerFrom(req);
  if (!token) return null;
  if (token.startsWith("shr_")) return resolveShareToken(db, token);
  return verifyToken(db, token);
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}${secure}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const newId = () => randomUUID();
