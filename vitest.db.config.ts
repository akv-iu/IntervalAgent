import { defineConfig } from "vitest/config";

// Explicit DB integration suite: npm run test:db. Never part of npm test.
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/db/**/*.test.ts"],
    setupFiles: ["tests/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
