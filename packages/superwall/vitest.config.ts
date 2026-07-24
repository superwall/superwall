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
      exclude: [
        "src/preview/server.ts",
        "src/preview/mount.tsx",
        "src/preview/surface.tsx",
        "src/preview/virtual.d.ts",
        "src/build/**",
        "**/*.config.ts",
        "test/**",
      ],
      thresholds: { statements: 90, branches: 80, functions: 85, lines: 90 },
    },
  },
});
