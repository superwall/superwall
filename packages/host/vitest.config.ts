import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text"],
      exclude: ["dist/**", "src/index.ts", "src/delegate/types.ts", "**/*.config.ts", "test/**"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
