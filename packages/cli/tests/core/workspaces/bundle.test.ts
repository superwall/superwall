import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { bundleWorkspace, resolveWranglerPackage } from "@/core/workspaces/bundle";
import { WorkspaceError } from "@/core/workspaces/project";
import { BUNDLE_MAX_BYTES } from "@/core/workspaces/wire";
import { fakeWrangler, workspaceProject } from "./fixture";

test("a bundle is one module with only a default export", async () => {
  const root = workspaceProject();
  const bundle = await bundleWorkspace(root, fakeWrangler("export default { fetch() {} }\n"));
  assert.equal(bundle.module, "export default { fetch() {} }\n");
  assert.equal(bundle.bytes, 30);
});

test("the builder's bundle rules apply locally", async () => {
  const root = workspaceProject();
  await assert.rejects(bundleWorkspace(root, fakeWrangler("x", { extra: "data.txt" })), /exactly one ES module.*data.txt/);
  await assert.rejects(bundleWorkspace(root, fakeWrangler("x", { exports: [] })), /no default export/);
  await assert.rejects(bundleWorkspace(root, fakeWrangler("x", { entry: false })), /no default export/);
  await assert.rejects(bundleWorkspace(root, fakeWrangler("x", { exports: ["default", "Counter"] })), /exports Counter/);
  await assert.rejects(bundleWorkspace(root, fakeWrangler("x".repeat(BUNDLE_MAX_BYTES + 1))), /the limit is/);
});

test("an empty output says it made nothing", async () => {
  const root = workspaceProject();
  await assert.rejects(
    bundleWorkspace(root, async (_root, args) => {
      fs.writeFileSync(args[args.indexOf("--metafile") + 1]!, "{}");
    }),
    /made nothing/,
  );
});

function installFakeWrangler(root: string, script: string): void {
  const dir = path.join(root, "node_modules", "wrangler");
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "wrangler", version: "1.0.0" }));
  fs.writeFileSync(path.join(dir, "bin", "wrangler.js"), script);
}

test("without an installed wrangler, it says to install", () => {
  assert.throws(() => resolveWranglerPackage(workspaceProject()), (error: Error) => {
    assert.ok(error instanceof WorkspaceError);
    assert.match(error.message, /npm install/);
    return true;
  });
});

test("it runs the project's own wrangler the way the builder does", async () => {
  const root = workspaceProject();
  installFakeWrangler(
    root,
    `const fs = require("node:fs"), path = require("node:path");
     const args = process.argv.slice(2);
     if (args[0] !== "deploy" || args[1] !== "--dry-run") process.exit(9);
     if (process.env.WRANGLER_SEND_METRICS !== "false") process.exit(8);
     const out = args[args.indexOf("--outdir") + 1];
     fs.writeFileSync(path.join(out, "worker.js"), "real");
     fs.writeFileSync(args[args.indexOf("--metafile") + 1], JSON.stringify({ outputs: { [path.relative(process.cwd(), path.join(out, "worker.js"))]: { entryPoint: "src/worker.ts", exports: ["default"] } } }));`,
  );
  const bundle = await bundleWorkspace(root);
  assert.equal(bundle.module, "real");
});

test("a failed bundle shows wrangler's own words, its error last", async () => {
  const root = workspaceProject();
  installFakeWrangler(root, `console.log("banner"); console.error("Expected ; but found x"); process.exit(1);`);
  await assert.rejects(bundleWorkspace(root), /didn't bundle:\nbanner\s+Expected ; but found x/);
  installFakeWrangler(root, "process.exit(1);");
  await assert.rejects(bundleWorkspace(root), /didn't bundle:/);
});
