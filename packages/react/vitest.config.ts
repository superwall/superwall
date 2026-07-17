import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace packages resolve to their TypeScript sources via the
  // superwall-ts condition. Vite 6+ replaces (not extends) the defaults when
  // conditions are set, and parts of the test pipeline resolve through the
  // SSR resolver — so both lists need the condition plus the defaults.
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
      thresholds: { statements: 95, branches: 85, functions: 90, lines: 95 },
    },
  },
});
