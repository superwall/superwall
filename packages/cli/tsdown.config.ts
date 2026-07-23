import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { entry: "src/entry.ts", auth: "src/core/auth/token.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  dts: true,
  // tsdown externalizes package.json dependencies automatically; our own
  // source (including the "@/" alias) is bundled.
  alias: {
    "@": "src",
  },
});
