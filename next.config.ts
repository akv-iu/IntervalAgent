import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // projectEnv() reads ".env" from disk, so file tracing would package it with the server code of a local build.
  // Never ship it: Vercel builds from git (no .env there), and a hand-uploaded local build must not carry keys.
  outputFileTracingExcludes: {
    "*": [".env", ".env.*", "**/.env", "**/.env.*"],
    "/*": ["fixtures/v2/evaluation/**/*", "scripts/v2-eval/**/*", "scripts/check-v2-fixtures.ts"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
