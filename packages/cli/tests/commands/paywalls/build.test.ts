import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { writeFakeFrameworkProject } from "../../helpers/framework";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = 0;
});

function project(): string {
  const root = writeFakeFrameworkProject();
  dirs.push(root);
  return root;
}

test("build writes one document per surface and platform, and lists them under --json", async () => {
  const root = project();
  const out = path.join(root, "out");

  const result = await runLine(`build ${root} --platform ios,web --out ${out} --json`);

  const builds = (result.json as { builds: Array<Record<string, unknown>> }).builds;
  assert.deepEqual(
    builds.map(({ kind, id, platform, file, snapshotId }) => ({ kind, id, platform, file, snapshotId })),
    [
      { kind: "paywall", id: "pro", platform: "ios", file: path.join(out, "paywall/pro/ios/index.html"), snapshotId: "snap0123456789ios" },
      { kind: "paywall", id: "pro", platform: "web", file: path.join(out, "paywall/pro/web/index.html"), snapshotId: "snap0123456789web" },
    ],
  );
  assert.equal(fs.readFileSync(path.join(out, "paywall/pro/ios/index.html"), "utf8"), "<html>pro ios</html>");
  assert.ok(fs.existsSync(path.join(root, "superwall.d.ts")));
});

test("build with no platform writes one platform-neutral document into the project's build directory", async () => {
  const root = project();

  const result = await runLine(`build ${root} --id pro`);

  const file = path.join(root, ".superwall", "build", "paywall", "pro", "index.html");
  assert.equal(fs.readFileSync(file, "utf8"), "<html>pro all</html>");
  assert.match(result.said("outro").join(), /1 snapshot built/);
  assert.match(result.said("step").join(), /paywall\/pro 2\.0 kB · snap0123 → .*paywall\/pro\/index\.html/);
});

test("build refuses an unknown platform and an unknown id before writing anything", async () => {
  const root = project();

  const platform = await runLine(`build ${root} --platform tvos --json`);
  assert.match((platform.json as { error: { message: string } }).error.message, /Unknown platform "tvos"/);
  const id = await runLine(`build ${root} --id nope --json`);
  assert.match((id.json as { error: { message: string } }).error.message, /No paywall or funnel named "nope" — this project has: pro/);
  assert.equal(fs.existsSync(path.join(root, ".superwall", "build")), false);
  assert.equal(process.exitCode, 1);
});

test("build in a directory without the framework says how to install it", async () => {
  const empty = fs.mkdtempSync(path.join(path.dirname(project()), "superwall-no-framework-"));
  dirs.push(empty);

  const result = await runLine(`build ${empty} --json`);

  assert.match((result.json as { error: { message: string } }).error.message, /npm i superwall/);
});

test("build takes no unknown flags and documents its own", async () => {
  await assert.rejects(runLine("build --watch"), /Unknown flag: --watch/);
  const help = await helpLine("build --help");
  assert.match(help, /Build your paywalls into the snapshot documents a push would version/);
  assert.match(help, /--platform/);
  assert.match(help, /--out <dir>/);
  assert.match(help, /build --id plus-upgrade --platform ios/);
});
