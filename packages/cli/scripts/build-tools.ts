import { readFileSync, writeFileSync } from "node:fs";
import { downloadAscIndex } from "@/core/app-store-connect/api/spec";
import { downloadApiIndex } from "@/core/api/reference";

interface ResolveArgs {
  path: string;
  kind: string;
}

declare const Bun: {
  build(options: {
    entrypoints: string[];
    outdir: string;
    naming: string;
    target: string;
    format: string;
    define: Record<string, string>;
    plugins: { name: string; setup(build: { onResolve(filter: { filter: RegExp }, resolve: (args: ResolveArgs) => unknown): void }): void }[];
  }): Promise<{ success: boolean; logs: unknown[] }>;
};

const PINNED = Number.MAX_SAFE_INTEGER;
const api = await downloadApiIndex();
const asc = await downloadAscIndex();
const seed = {
  "api-index.json": JSON.stringify({ ...api, fetchedAt: PINNED }),
  "asc-index.json": JSON.stringify({ ...asc, fetchedAt: PINNED }),
};

const result = await Bun.build({
  entrypoints: ["src/tools.ts"],
  outdir: "dist",
  naming: "tools.js",
  target: "browser",
  format: "esm",
  define: { "process.env.SUPERWALL_TOOLS_SEED": JSON.stringify(JSON.stringify(seed)) },
  plugins: [
    {
      name: "cli-only-stays-out",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === "dynamic-import") return { path: args.path, external: true };
          return undefined;
        });
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const CLI_ONLY = 'Promise.reject(new Error("This needs the Superwall CLI on your machine: npx superwall"))';
const bundle = readFileSync("dist/tools.js", "utf8").replace(/\bimport\(\s*["'][^"']+["']\s*\)/g, CLI_ONLY);
writeFileSync("dist/tools.js", bundle);
const reached = [...bundle.matchAll(/^import\s.*?from\s*["']([^"']+)["']/gm)].map(([, path]) => path);
if (reached.length > 0) {
  console.error(`dist/tools.js imports ${reached.join(", ")}; the MCP bundle must stand alone.`);
  process.exit(1);
}
console.log(
  `dist/tools.js: ${(bundle.length / 1024).toFixed(0)} kB, self-contained, API reference ${api.version} and App Store Connect spec ${asc.specVersion} built in`,
);
