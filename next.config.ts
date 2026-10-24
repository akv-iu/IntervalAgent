import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // projectEnv() reads ".env" from disk, so file tracing would package it with the server code of a local build.
  // Never ship it: Vercel builds from git (no .env there), and a hand-uploaded local build must not carry keys.
  outputFileTracingExcludes: { "*": [".env", ".env.*", "**/.env", "**/.env.*"] },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        // Leave CSS Modules to Next.js so their class-name exports remain intact.
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
