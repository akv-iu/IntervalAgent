import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Offline suite. tests/db/** is excluded no matter what env vars are set.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }, // same as tsconfig paths
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "tests/db/**", "tests/v2-db/**"],
    setupFiles: ["tests/setup.ts"],
  },
});
