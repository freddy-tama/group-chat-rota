import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (the in-process Postgres used without DATABASE_URL) ships WebAssembly; keep it unbundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: { "/api/**": ["./drizzle/**"] },
  poweredByHeader: false,
};

export default nextConfig;
