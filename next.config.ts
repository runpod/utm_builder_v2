import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Drizzle loads SQL migrations from the filesystem at runtime. Include the
  // complete folder in every server trace so Vercel functions can initialize
  // and upgrade the registry database after deployment.
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
};

export default nextConfig;
