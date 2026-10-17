import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { hashPassword, issueToken, verifyPassword } from "@/lib/auth";
import { ApiError } from "./http";
import { seedCornerCafe } from "./seed";

export const Credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

export async function register(db: Db, input: z.infer<typeof Credentials>) {
  const [existing] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, input.email));
  if (existing) throw new ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.");
  const id = randomUUID();
  await db.insert(t.users).values({ id, email: input.email, passwordHash: await hashPassword(input.password), isDemo: false });
  // New accounts start with their own copy of the sample café so the board is never empty.
  const { workspaceId, weekId } = await seedCornerCafe(db, id, { isDemo: false });
  return { user: { id, email: input.email }, token: await issueToken(db, id, false), workspaceId, weekId };
}

export async function login(db: Db, input: z.infer<typeof Credentials>) {
  const [user] = await db.select().from(t.users).where(and(eq(t.users.email, input.email), eq(t.users.isDemo, false)));
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new ApiError(401, "bad_credentials", "Email or password is wrong.");
  }
  const [ws] = await db.select({ id: t.workspaces.id }).from(t.workspaces).where(eq(t.workspaces.ownerId, user.id)).limit(1);
  return { user: { id: user.id, email: user.email }, token: await issueToken(db, user.id, false), workspaceId: ws?.id ?? null };
}

/** Try demo: a throwaway guest owning a fresh seeded café that expires after 24 h. */
export async function startDemo(db: Db) {
  await purgeExpiredDemos(db);
  const id = randomUUID();
  await db.insert(t.users).values({ id, email: `guest-${id}@demo.invalid`, isDemo: true });
  const { workspaceId, weekId } = await seedCornerCafe(db, id, { isDemo: true });
  return { token: await issueToken(db, id, true), workspaceId, weekId };
}

export async function purgeExpiredDemos(db: Db) {
  const expired = await db
    .select({ owner: t.workspaces.ownerId })
    .from(t.workspaces)
    .where(and(eq(t.workspaces.isDemo, true), lt(t.workspaces.expiresAt, new Date())))
    .limit(25);
  for (const { owner } of expired) await db.delete(t.users).where(and(eq(t.users.id, owner), eq(t.users.isDemo, true)));
  return expired.length;
}

export async function me(db: Db, userId: string) {
  const [user] = await db.select({ id: t.users.id, email: t.users.email, isDemo: t.users.isDemo }).from(t.users).where(eq(t.users.id, userId));
  if (!user) throw new ApiError(401, "unauthenticated", "This session has ended. Start a new demo or sign in.");
  const workspaces = await db
    .select({
      id: t.workspaces.id, name: t.workspaces.name, timezone: t.workspaces.timezone, isDemo: t.workspaces.isDemo,
      currentWeekId: sql<string | null>`(select w.id from weeks w where w.workspace_id = ${t.workspaces.id} order by w.week_start desc limit 1)`,
    })
    .from(t.workspaces)
    .where(eq(t.workspaces.ownerId, userId));
  return { user, workspaces };
}
