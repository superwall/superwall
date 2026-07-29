import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { entry: "src/entry.ts", auth: "src/core/auth/token.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  dts: true,
  noExternal: [
    "ink",
    "ink-spinner",
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-reconciler",
    "scheduler",
  ],
  external: ["react-devtools-core"],
  alias: {
    "@": "src",
  },
});
