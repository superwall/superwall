import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { RepoDownloadError } from "@/core/repo/download";
import { ArtifactError } from "@/core/artifacts/project";
import { runArtifactCreate, runArtifactUpdate, type CreateRuntime } from "@/core/artifacts/starter";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { repoTarball, respondWith, scratch, artifactProject, writeVendoredSdk } from "./fixture";

const STARTER = {
  "artifacts/starter/package.json": JSON.stringify({ name: "superwall-artifact-starter", dependencies: {} }),
  "artifacts/starter/package-lock.json": JSON.stringify({ name: "superwall-artifact-starter", packages: { "": { name: "superwall-artifact-starter" } } }),
  "artifacts/starter/superwall.json": JSON.stringify({
    name: "My artifact",
    scopes: [],
    entrypoints: [{ id: "home", slot: "org.page@1", title: "My artifact", path: "/" }, { id: "m", slot: "chart.source@1", title: "M" }],
  }),
  "artifacts/starter/wrangler.jsonc": '{ "name": "superwall-artifact-starter" }',
  "artifacts/starter/src/worker.ts": "export default {}\n",
  "artifacts/starter/vendor/artifact-sdk/package.json": JSON.stringify({ name: "@superwall/artifact-sdk", version: "0.2.0" }),
  "artifacts/starter/vendor/artifact-sdk/server.mjs": "export {}\n",
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
  await runArtifactCreate(ctx, { dir: target, install: true }, {
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
  assert.match(said("note")[0]!, /superwall artifacts dev/);
  assert.doesNotMatch(said("note")[0]!, /npm install/);
});

test("create defaults to my-artifact, and --no-install leaves that step to you", async () => {
  const cwd = process.cwd();
  process.chdir(scratch());
  try {
    const { ctx, said } = context();
    await runArtifactCreate(ctx, { install: false }, { fetch: download() });
    assert.ok(fs.existsSync("my-artifact/superwall.json"));
    assert.match(said("note")[0]!, /cd my-artifact\nnpm install\nsuperwall artifacts dev/);
  } finally {
    process.chdir(cwd);
  }
});

test("a directory with no usable name still gets a package name", async () => {
  const target = path.join(scratch(), "!!!");
  const { ctx } = context();
  await runArtifactCreate(ctx, { dir: target, install: false }, { fetch: download() });
  assert.equal(json(path.join(target, "package.json")).name, "my-artifact");
});

test("create refuses a directory with files in it", async () => {
  const target = scratch();
  fs.writeFileSync(path.join(target, "keep"), "x");
  const { ctx } = context();
  await assert.rejects(runArtifactCreate(ctx, { dir: target, install: false }, { fetch: download() }), ArtifactError);
  assert.ok(fs.existsSync(path.join(target, "keep")));
});

test("create on a file says so", async () => {
  const target = path.join(scratch(), "file");
  fs.writeFileSync(target, "x");
  const { ctx } = context();
  await assert.rejects(runArtifactCreate(ctx, { dir: target, install: false }, { fetch: download() }), /is a file/);
  assert.equal(fs.readFileSync(target, "utf8"), "x");
});

test("a failed create . leaves the empty directory it was given", async () => {
  const target = scratch();
  const cwd = process.cwd();
  process.chdir(target);
  const { ctx } = context();
  try {
    await assert.rejects(runArtifactCreate(ctx, { dir: ".", install: false }, { fetch: respondWith(500, Buffer.from("")) as never }), /HTTP 500/);
    assert.ok(fs.existsSync(target));
    await assert.rejects(
      runArtifactCreate(ctx, { dir: ".", install: false }, { fetch: respondWith(200, repoTarball({ "artifacts/starter/README.md": "no project" })) as never }),
    );
    assert.ok(fs.existsSync(target));
    assert.deepEqual(fs.readdirSync(target), []);
  } finally {
    process.chdir(cwd);
  }
});

test("a failed download leaves nothing behind", async () => {
  const target = path.join(scratch(), "new");
  const { ctx } = context();
  await assert.rejects(
    runArtifactCreate(ctx, { dir: target, install: false }, { fetch: respondWith(500, Buffer.from("")) as never }),
    /HTTP 500/,
  );
  assert.equal(fs.existsSync(target), false);
  await assert.rejects(
    runArtifactCreate(ctx, { dir: target, install: false }, { fetch: respondWith(200, repoTarball({ "other/x": "" })) as never }),
    /No starter at artifacts\/starter/,
  );
  assert.equal(fs.existsSync(target), false);
});

test("a failed install isn't fatal and says what's left", async () => {
  const target = path.join(scratch(), "new");
  const { ctx, said } = context();
  await runArtifactCreate(ctx, { dir: target, install: true }, {
    fetch: download(),
    install: async () => { throw new Error("no npm"); },
  });
  assert.match(said("note")[0]!, /npm install/);
});

test("update replaces the vendored SDK and points package.json at it", async () => {
  const root = artifactProject();
  writeVendoredSdk(root, "0.1.0");
  fs.writeFileSync(path.join(root, "vendor", "artifact-sdk", "stale.mjs"), "old");
  let installed = false;
  const { ctx, said } = context();
  await runArtifactUpdate(ctx, { dir: root, install: true }, {
    fetch: download(),
    install: async () => { installed = true; },
  });
  assert.ok(installed);
  assert.deepEqual(fs.readdirSync(path.join(root, "vendor", "artifact-sdk")).sort(), ["package.json", "server.mjs"]);
  assert.equal(json(path.join(root, "package.json")).dependencies["@superwall/artifact-sdk"], "file:vendor/artifact-sdk");
  assert.match(said("success")[0]!, /Commit vendor\/artifact-sdk/);
});

test("update defaults to the current directory, and adds the SDK to an artifact without one", async () => {
  const root = artifactProject();
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const { ctx, said } = context();
    await runArtifactUpdate(ctx, { install: false }, { fetch: download() });
    assert.ok(fs.existsSync("vendor/artifact-sdk/server.mjs"));
    assert.match(said("info")[0]!, /npm install/);
  } finally {
    process.chdir(cwd);
  }
});

test("update on the latest version says so", async () => {
  const root = artifactProject();
  writeVendoredSdk(root, "0.2.0");
  const { ctx, said } = context();
  await runArtifactUpdate(ctx, { dir: root, install: false }, { fetch: download() });
  assert.ok(said("spinner.stop").some((text) => text.includes("Already on the latest")));
});

test("update keeps what's there when the download fails, and survives a failed install", async () => {
  const root = artifactProject();
  writeVendoredSdk(root, "0.1.0");
  const { ctx, said } = context();
  await assert.rejects(
    runArtifactUpdate(ctx, { dir: root, install: false }, { fetch: respondWith(500, Buffer.from("")) as never }),
    RepoDownloadError,
  );
  assert.equal(json(path.join(root, "vendor/artifact-sdk/package.json")).version, "0.1.0");
  await assert.rejects(
    runArtifactUpdate(ctx, { dir: root, install: false }, { fetch: respondWith(200, repoTarball({ "artifacts/starter/vendor/artifact-sdk/package.json": "{}" })) as never }),
    /has no version/,
  );
  await assert.rejects(
    runArtifactUpdate(ctx, { dir: root, install: false }, { fetch: respondWith(200, repoTarball({ "other/x": "" })) as never }),
    /No artifact SDK/,
  );
  await runArtifactUpdate(ctx, { dir: root, install: true }, {
    fetch: download(),
    install: async () => { throw new Error("no npm"); },
  });
  assert.match(said("warn")[0]!, /npm install/);
});

test("update leaves package.json's formatting alone when it already points at the SDK", async () => {
  const root = artifactProject();
  const text = '{"name":"x","dependencies":{"@superwall/artifact-sdk":"file:vendor/artifact-sdk"},\n\t"private":true}';
  fs.writeFileSync(path.join(root, "package.json"), text);
  const { ctx } = context();
  await runArtifactUpdate(ctx, { dir: root, install: false }, { fetch: download() });
  assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), text);
});

test("update keeps package.json's indent and final newline when it has to add the SDK", async () => {
  const root = artifactProject();
  fs.writeFileSync(path.join(root, "package.json"), '{\n\t"name": "x"\n}\n');
  const { ctx } = context();
  await runArtifactUpdate(ctx, { dir: root, install: false }, { fetch: download() });
  assert.equal(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
    '{\n\t"name": "x",\n\t"dependencies": {\n\t\t"@superwall/artifact-sdk": "file:vendor/artifact-sdk"\n\t}\n}\n',
  );
});

test("update won't replace a newer SDK unless it's forced", async () => {
  const root = artifactProject();
  writeVendoredSdk(root, "9.9.9");
  const { ctx, said } = context();
  await runArtifactUpdate(ctx, { dir: root, install: true }, { fetch: download(), install: async () => assert.fail("nothing changed") });
  assert.equal(json(path.join(root, "vendor/artifact-sdk/package.json")).version, "9.9.9");
  assert.match(said("warn")[0]!, /--force/);
  await runArtifactUpdate(ctx, { dir: root, install: false, force: true }, { fetch: download() });
  assert.equal(json(path.join(root, "vendor/artifact-sdk/package.json")).version, "0.2.0");
});

test("update changes nothing when package.json is missing", async () => {
  const root = artifactProject();
  writeVendoredSdk(root, "0.1.0");
  fs.rmSync(path.join(root, "package.json"));
  const { ctx } = context();
  await assert.rejects(runArtifactUpdate(ctx, { dir: root, install: false }, { fetch: async () => assert.fail("no download") }), /No package\.json/);
  assert.equal(json(path.join(root, "vendor/artifact-sdk/package.json")).version, "0.1.0");
});

test("update moves the new SDK into place and leaves nothing beside it", async () => {
  const root = artifactProject();
  writeVendoredSdk(root, "0.1.0");
  const { ctx } = context();
  await runArtifactUpdate(ctx, { dir: root, install: false }, { fetch: download() });
  assert.deepEqual(fs.readdirSync(path.join(root, "vendor")), ["artifact-sdk"]);
});

test("update puts the old SDK back when the move fails", async () => {
  const root = artifactProject();
  writeVendoredSdk(root, "0.1.0");
  const { ctx } = context();
  let calls = 0;
  const rename: typeof fs.renameSync = (from, to) => {
    calls += 1;
    if (calls === 2) throw new Error("disk full");
    fs.renameSync(from, to);
  };
  await assert.rejects(runArtifactUpdate(ctx, { dir: root, install: false }, { fetch: download(), rename }), /disk full/);
  assert.equal(json(path.join(root, "vendor/artifact-sdk/package.json")).version, "0.1.0");
  assert.deepEqual(fs.readdirSync(path.join(root, "vendor")), ["artifact-sdk"]);
});

test("update needs an artifact", async () => {
  const { ctx } = context();
  await assert.rejects(runArtifactUpdate(ctx, { dir: scratch(), install: false }), /superwall artifacts create/);
});
