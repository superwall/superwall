import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      reporter: ["text"],
      exclude: ["dist/**", "src/main.tsx", "src/index.ts", "**/*.config.ts", "test/**"],
      thresholds: { statements: 88, branches: 85, functions: 80, lines: 88 },
    },
  },
});
