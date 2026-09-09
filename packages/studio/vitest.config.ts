import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      reporter: ["text"],
      exclude: [
        "dist/**",
        "src/main.tsx",
        "src/index.ts",
        "src/lib/contract.ts",
        "src/vite-env.d.ts",
        "**/*.config.ts",
        "test/**",
      ],
      thresholds: { statements: 98, branches: 91, functions: 95, lines: 98 },
    },
  },
});
