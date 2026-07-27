import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["superwall-ts", ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: ["superwall-ts", ...defaultServerConditions],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      reporter: ["text"],
      // main.tsx is the app bootstrap (fetch + render) — exercised by the
      // built app under `superwall dev`; index.ts is a re-export barrel.
      exclude: ["src/main.tsx", "src/index.ts", "**/*.config.ts", "test/**"],
      thresholds: { statements: 88, branches: 85, functions: 80, lines: 88 },
    },
  },
});
