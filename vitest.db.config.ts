import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Explicit DB integration suite: npm run test:db. Never part of npm test.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }, // same as tsconfig paths
  test: {
    globals: true,
    include: ["tests/db/**/*.test.ts"],
    setupFiles: ["tests/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
