import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Ensure the Drizzle migration files (SQL + meta/_journal.json) are traced
  // into the serverless function bundle, so runtime migrate() can find them.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
};

export default nextConfig;
