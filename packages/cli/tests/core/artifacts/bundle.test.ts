import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { bundleArtifact, resolveWranglerPackage } from "@/core/artifacts/bundle";
import { ArtifactError } from "@/core/artifacts/project";
import { BUNDLE_MAX_BYTES } from "@/core/artifacts/wire";
import { fakeWrangler, artifactProject, withAcceptedConfig } from "./fixture";

test("a bundle is one module with only a default export", async () => {
  const root = artifactProject();
  const bundle = await bundleArtifact(root, fakeWrangler("export default { fetch() {} }\n"));
  assert.equal(bundle.module, "export default { fetch() {} }\n");
  assert.equal(bundle.bytes, 30);
});

test("the builder's bundle rules apply locally", async () => {
  const root = artifactProject();
  await assert.rejects(bundleArtifact(root, fakeWrangler("x", { extra: "data.txt" })), /exactly one ES module.*data.txt/);
  await assert.rejects(bundleArtifact(root, fakeWrangler("x", { exports: [] })), /no default export/);
  await assert.rejects(bundleArtifact(root, fakeWrangler("x", { entry: false })), /no default export/);
  await assert.rejects(bundleArtifact(root, fakeWrangler("x", { exports: ["default", "Counter"] })), /exports Counter/);
  await assert.rejects(bundleArtifact(root, fakeWrangler("x".repeat(BUNDLE_MAX_BYTES + 1))), /the limit is/);
});

test("an empty output says it made nothing", async () => {
  const root = artifactProject();
  await assert.rejects(
    bundleArtifact(root, withAcceptedConfig(async (_root, args) => {
      fs.writeFileSync(args[args.indexOf("--metafile") + 1]!, "{}");
    })),
    /made nothing/,
  );
});

function installFakeWrangler(root: string, script: string): void {
  const dir = path.join(root, "node_modules", "wrangler");
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "wrangler", version: "1.0.0", main: "index.mjs" }));
  fs.writeFileSync(path.join(dir, "bin", "wrangler.js"), script);
  fs.writeFileSync(
    path.join(dir, "index.mjs"),
    `export const unstable_readConfig = () => ({ configPath: "superwall.json", main: "src/worker.ts", compatibility_date: "2026-09-01" });`,
  );
}

test("without an installed wrangler, it says to install", () => {
  assert.throws(() => resolveWranglerPackage(artifactProject()), (error: Error) => {
    assert.ok(error instanceof ArtifactError);
    assert.match(error.message, /npm install/);
    return true;
  });
});

test("it runs the project's own wrangler the way the builder does", async () => {
  const root = artifactProject();
  installFakeWrangler(
    root,
    `const fs = require("node:fs"), path = require("node:path");
     const args = process.argv.slice(2);
     if (args[0] !== "deploy" || args[1] !== "--dry-run") process.exit(9);
     if (process.env.WRANGLER_SEND_METRICS !== "false") process.exit(8);
     if (args[args.indexOf("--config") + 1] !== "superwall.json") process.exit(7);
     if (args[args.indexOf("--env-file") + 1] !== require("node:os").devNull) process.exit(6);
     if (process.env.CLOUDFLARE_ENV !== undefined) process.exit(5);
     const out = args[args.indexOf("--outdir") + 1];
     fs.writeFileSync(path.join(out, "worker.js"), "real");
     fs.writeFileSync(args[args.indexOf("--metafile") + 1], JSON.stringify({ outputs: { [path.relative(process.cwd(), path.join(out, "worker.js"))]: { entryPoint: "src/worker.ts", exports: ["default"] } } }));`,
  );
  process.env.CLOUDFLARE_ENV = "from-my-shell";
  try {
    const bundle = await bundleArtifact(root);
    assert.equal(bundle.module, "real");
  } finally {
    delete process.env.CLOUDFLARE_ENV;
  }
});

test("a failed bundle shows wrangler's own words, its error last", async () => {
  const root = artifactProject();
  installFakeWrangler(root, `console.log("banner"); console.error("Expected ; but found x"); process.exit(1);`);
  await assert.rejects(bundleArtifact(root), /didn't bundle:\nbanner\s+Expected ; but found x/);
  installFakeWrangler(root, "process.exit(1);");
  await assert.rejects(bundleArtifact(root), /didn't bundle:/);
});
