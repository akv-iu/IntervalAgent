import { configDefaults, defineConfig } from "vitest/config";

// Offline suite. tests/db/** is excluded no matter what env vars are set.
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "tests/db/**"],
    setupFiles: ["tests/setup.ts"],
  },
});
