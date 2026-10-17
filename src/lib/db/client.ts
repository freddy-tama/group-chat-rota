import path from "node:path";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

// Production and previews use Postgres (Neon) through DATABASE_URL. Without it (local dev and the
// unit tests) the app runs on PGlite, an in-process Postgres, so the same SQL runs everywhere.

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

interface DbState {
  db: Db;
  ready: Promise<void>;
  kind: "postgres" | "pglite";
}

const globalForDb = globalThis as unknown as { __gcrDb?: DbState };

function create(): DbState {
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });
    const db = drizzlePostgres(sql, { schema }) as unknown as Db;
    // Migrations run in the build step (scripts/migrate.mjs); nothing to wait for here.
    return { db, ready: Promise.resolve(), kind: "postgres" };
  }
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  const ready = migratePglite(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, ready, kind: "pglite" };
}

export async function getDb(): Promise<Db> {
  if (!globalForDb.__gcrDb) globalForDb.__gcrDb = create();
  await globalForDb.__gcrDb.ready;
  return globalForDb.__gcrDb.db;
}

export function dbKind(): "postgres" | "pglite" {
  if (!globalForDb.__gcrDb) globalForDb.__gcrDb = create();
  return globalForDb.__gcrDb.kind;
}

/** Fresh isolated in-memory database, for tests. */
export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

export async function migrateUrl(url: string) {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await migratePostgres(drizzlePostgres(sql), { migrationsFolder: MIGRATIONS });
  } finally {
    await sql.end();
  }
}
