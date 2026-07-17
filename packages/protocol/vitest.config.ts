import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      // terminal summary only — no coverage/ artifacts on disk
      reporter: ["text"],
      thresholds: { statements: 95, branches: 90, functions: 100, lines: 95 },
    },
  },
});
