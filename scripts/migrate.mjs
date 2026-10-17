// Runs database migrations before `next build` on Vercel. Skips when DATABASE_URL is unset
// (local builds use the in-process PGlite database, which migrates itself on start).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL not set; skipping (PGlite migrates at runtime).");
  process.exit(0);
}
const sql = postgres(url, { max: 1, prepare: false });
try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("[migrate] migrations applied");
} finally {
  await sql.end();
}
