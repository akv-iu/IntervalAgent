import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { globals: true, include: ["tests/v2-db/**/*.test.ts"], setupFiles: ["tests/setup.ts"], fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000 },
});
