import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text"],
      thresholds: { statements: 95, branches: 85, functions: 90, lines: 95 },
    },
  },
});
