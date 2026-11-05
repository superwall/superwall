import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { RepoDownloadError } from "@/core/repo/download";
import { WorkspaceError } from "@/core/workspaces/project";
import { runWorkspaceCreate, runWorkspaceUpdate, type CreateRuntime } from "@/core/workspaces/starter";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { repoTarball, respondWith, scratch, workspaceProject, writeVendoredSdk } from "./fixture";

const STARTER = {
  "workspaces/starter/package.json": JSON.stringify({ name: "superwall-workspace-starter", dependencies: {} }),
  "workspaces/starter/package-lock.json": JSON.stringify({ name: "superwall-workspace-starter", packages: { "": { name: "superwall-workspace-starter" } } }),
  "workspaces/starter/superwall.json": JSON.stringify({
    name: "My workspace",
    scopes: [],
    entrypoints: [{ id: "home", slot: "org.page@1", title: "My workspace", path: "/" }, { id: "m", slot: "chart.source@1", title: "M" }],
  }),
  "workspaces/starter/wrangler.jsonc": '{ "name": "superwall-workspace-starter" }',
  "workspaces/starter/src/worker.ts": "export default {}\n",
  "workspaces/starter/vendor/workspace-sdk/package.json": JSON.stringify({ name: "@superwall/workspace-sdk", version: "0.2.0" }),
  "workspaces/starter/vendor/workspace-sdk/server.mjs": "export {}\n",
  "examples/minimal/package.json": "{}",
};

function context() {
  const calls: RendererCall[] = [];
  const ui = recordingRenderer(calls);
  return {
    ctx: { ui } as never,
    said: (method: string) =>
      calls
        .filter((call) => call.method === method)
        .map((call) => String((call.value as { value?: unknown } | undefined)?.value ?? call.value)),
  };
}

const download = (): CreateRuntime["fetch"] => respondWith(200, repoTarball(STARTER)) as never;
const json = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

test("create downloads only the starter, names it after its directory and installs", async () => {
  const target = path.join(scratch(), "Churn Copilot");
  let installedIn = "";
  const { ctx, said } = context();
  await runWorkspaceCreate(ctx, { dir: target, install: true }, {
    fetch: download(),
    install: async (root) => { installedIn = root; },
  });
  assert.equal(installedIn, target);
  assert.deepEqual(fs.readdirSync(target).sort(), ["package-lock.json", "package.json", "src", "superwall.json", "vendor", "wrangler.jsonc"]);
  assert.equal(json(path.join(target, "package.json")).name, "churn-copilot");
  const lock = json(path.join(target, "package-lock.json"));
  assert.equal(lock.name, "churn-copilot");
  assert.equal(lock.packages[""].name, "churn-copilot");
  const manifest = json(path.join(target, "superwall.json"));
  assert.equal(manifest.name, "Churn copilot");
  assert.equal(manifest.entrypoints[0].title, "Churn copilot");
  assert.equal(manifest.entrypoints[1].title, "M");
  assert.match(fs.readFileSync(path.join(target, "wrangler.jsonc"), "utf8"), /churn-copilot/);
  assert.match(said("note")[0]!, /superwall workspaces dev/);
  assert.doesNotMatch(said("note")[0]!, /npm install/);
});

test("create defaults to my-workspace, and --no-install leaves that step to you", async () => {
  const cwd = process.cwd();
  process.chdir(scratch());
  try {
    const { ctx, said } = context();
    await runWorkspaceCreate(ctx, { install: false }, { fetch: download() });
    assert.ok(fs.existsSync("my-workspace/superwall.json"));
    assert.match(said("note")[0]!, /cd my-workspace\nnpm install\nsuperwall workspaces dev/);
  } finally {
    process.chdir(cwd);
  }
});

test("a directory with no usable name still gets a package name", async () => {
  const target = path.join(scratch(), "!!!");
  const { ctx } = context();
  await runWorkspaceCreate(ctx, { dir: target, install: false }, { fetch: download() });
  assert.equal(json(path.join(target, "package.json")).name, "my-workspace");
});

test("create refuses a directory with files in it", async () => {
  const target = scratch();
  fs.writeFileSync(path.join(target, "keep"), "x");
  const { ctx } = context();
  await assert.rejects(runWorkspaceCreate(ctx, { dir: target, install: false }, { fetch: download() }), WorkspaceError);
  assert.ok(fs.existsSync(path.join(target, "keep")));
});

test("a failed download leaves nothing behind", async () => {
  const target = path.join(scratch(), "new");
  const { ctx } = context();
  await assert.rejects(
    runWorkspaceCreate(ctx, { dir: target, install: false }, { fetch: respondWith(500, Buffer.from("")) as never }),
    /HTTP 500/,
  );
  assert.equal(fs.existsSync(target), false);
  await assert.rejects(
    runWorkspaceCreate(ctx, { dir: target, install: false }, { fetch: respondWith(200, repoTarball({ "other/x": "" })) as never }),
    /No starter at workspaces\/starter/,
  );
  assert.equal(fs.existsSync(target), false);
});

test("a failed install isn't fatal and says what's left", async () => {
  const target = path.join(scratch(), "new");
  const { ctx, said } = context();
  await runWorkspaceCreate(ctx, { dir: target, install: true }, {
    fetch: download(),
    install: async () => { throw new Error("no npm"); },
  });
  assert.match(said("note")[0]!, /npm install/);
});

test("update replaces the vendored SDK and points package.json at it", async () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "0.1.0");
  fs.writeFileSync(path.join(root, "vendor", "workspace-sdk", "stale.mjs"), "old");
  let installed = false;
  const { ctx, said } = context();
  await runWorkspaceUpdate(ctx, { dir: root, install: true }, {
    fetch: download(),
    install: async () => { installed = true; },
  });
  assert.ok(installed);
  assert.deepEqual(fs.readdirSync(path.join(root, "vendor", "workspace-sdk")).sort(), ["package.json", "server.mjs"]);
  assert.equal(json(path.join(root, "package.json")).dependencies["@superwall/workspace-sdk"], "file:vendor/workspace-sdk");
  assert.match(said("success")[0]!, /Commit vendor\/workspace-sdk/);
});

test("update defaults to the current directory, and adds the SDK to a workspace without one", async () => {
  const root = workspaceProject();
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const { ctx, said } = context();
    await runWorkspaceUpdate(ctx, { install: false }, { fetch: download() });
    assert.ok(fs.existsSync("vendor/workspace-sdk/server.mjs"));
    assert.match(said("info")[0]!, /npm install/);
  } finally {
    process.chdir(cwd);
  }
});

test("update on the latest version says so", async () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "0.2.0");
  const { ctx, said } = context();
  await runWorkspaceUpdate(ctx, { dir: root, install: false }, { fetch: download() });
  assert.ok(said("spinner.stop").some((text) => text.includes("Already on the latest")));
});

test("update keeps what's there when the download fails, and survives a failed install", async () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "0.1.0");
  const { ctx, said } = context();
  await assert.rejects(
    runWorkspaceUpdate(ctx, { dir: root, install: false }, { fetch: respondWith(500, Buffer.from("")) as never }),
    RepoDownloadError,
  );
  assert.equal(json(path.join(root, "vendor/workspace-sdk/package.json")).version, "0.1.0");
  await assert.rejects(
    runWorkspaceUpdate(ctx, { dir: root, install: false }, { fetch: respondWith(200, repoTarball({ "workspaces/starter/vendor/workspace-sdk/package.json": "{}" })) as never }),
    /has no version/,
  );
  await assert.rejects(
    runWorkspaceUpdate(ctx, { dir: root, install: false }, { fetch: respondWith(200, repoTarball({ "other/x": "" })) as never }),
    /No workspace SDK/,
  );
  await runWorkspaceUpdate(ctx, { dir: root, install: true }, {
    fetch: download(),
    install: async () => { throw new Error("no npm"); },
  });
  assert.match(said("warn")[0]!, /npm install/);
});

test("update needs a workspace", async () => {
  const { ctx } = context();
  await assert.rejects(runWorkspaceUpdate(ctx, { dir: scratch(), install: false }), /superwall workspaces create/);
});
