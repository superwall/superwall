import { defineConfig } from "vitest/config";

export default defineConfig({
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
        "**/*.config.ts",
        "test/**",
      ],
      thresholds: { statements: 90, branches: 80, functions: 85, lines: 90 },
    },
  },
});
