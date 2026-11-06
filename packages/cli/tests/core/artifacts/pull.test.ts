import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { readBinding } from "@/core/artifacts/binding";
import { runArtifactPull } from "@/core/artifacts/pull";
import { runArtifactPush } from "@/core/artifacts/push";
import { hasGitHttpBackend, startLocalGitRemote, type LocalGitRemote } from "../../helpers/git-remote";
import { fakeContext, fakeArtifactApi } from "./fake-api";
import { MANIFEST, scratch, artifactProject, writeVendoredSdk } from "./fixture";

const skip = hasGitHttpBackend() ? false : "this machine's git can't serve";
let remote: LocalGitRemote;
before(async () => {
  if (!skip) remote = await startLocalGitRemote();
});
after(async () => {
  await remote?.close();
});

const noWait = { sleep: async () => undefined, fetchVersion: async () => ({ ok: false, json: async () => ({}) }) };

async function pushed() {
  const root = artifactProject();
  writeVendoredSdk(root, "0.1.0");
  const fake = fakeArtifactApi({ remote, manifest: MANIFEST as never });
  const context = fakeContext(fake.api);
  await runArtifactPush(context.ctx, { dir: root, org: "7", overwriteSource: false }, noWait);
  return { root, fake, context, id: readBinding(root)!.artifactId };
}

test("pull into an empty folder gets the source and links it", { skip }, async () => {
  const { fake, id } = await pushed();
  const target = path.join(scratch(), "clone");
  const { ctx, said } = fakeContext(fake.api);
  await runArtifactPull(ctx, { dir: target, artifact: id, theirs: false });
  assert.ok(fs.existsSync(path.join(target, "superwall.json")));
  const binding = readBinding(target)!;
  assert.equal(binding.artifactId, id);
  assert.equal(binding.syncedCommit, remote.headOf(`ws-${id}`));
  assert.match(said("info").join(), /npm install && superwall artifacts dev/);
});

test("a teammate's push merges with local edits, and pushing after it needs no force", { skip }, async () => {
  const { root, fake, id } = await pushed();
  const clone = path.join(scratch(), "clone");
  const teammate = fakeContext(fake.api);
  await runArtifactPull(teammate.ctx, { dir: clone, artifact: id, theirs: false });
  fs.writeFileSync(path.join(clone, "src/theirs.ts"), "theirs");
  await runArtifactPush(teammate.ctx, { dir: clone, overwriteSource: false }, noWait);

  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  const mine = fakeContext(fake.api, { json: true });
  await runArtifactPull(mine.ctx, { dir: root, theirs: false });
  assert.equal(fs.readFileSync(path.join(root, "src/theirs.ts"), "utf8"), "theirs");
  assert.equal(fs.readFileSync(path.join(root, "src/mine.ts"), "utf8"), "mine");
  assert.deepEqual((mine.data[0] as { written: string[] }).written, ["src/theirs.ts"]);

  const again = fakeContext(fake.api);
  await runArtifactPull(again.ctx, { dir: root, theirs: false });
  assert.match(again.said("success").join(), /Already up to date/);

  const pushing = fakeContext(fake.api);
  await runArtifactPush(pushing.ctx, { dir: root, overwriteSource: false }, noWait);
  const files = remote.filesOf(`ws-${id}`);
  assert.ok(files.includes("src/theirs.ts") && files.includes("src/mine.ts"));
});

test("an untracked file in the way is left alone and named", { skip }, async () => {
  const { fake, id } = await pushed();
  const clone = path.join(scratch(), "clone");
  const teammate = fakeContext(fake.api);
  await runArtifactPull(teammate.ctx, { dir: clone, artifact: id, theirs: false });
  fs.writeFileSync(path.join(clone, "src/late.ts"), "theirs");
  await runArtifactPush(teammate.ctx, { dir: clone, overwriteSource: false }, noWait);

  const other = path.join(scratch(), "other");
  fs.mkdirSync(path.join(other, "src"), { recursive: true });
  fs.writeFileSync(path.join(other, "superwall.json"), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(other, "superwall.artifact.json"), JSON.stringify({ artifact_id: Number(id), organization_id: 7, slug: "test-artifact" }));
  fs.writeFileSync(path.join(other, ".gitignore"), "src/late.ts\n");
  fs.writeFileSync(path.join(other, "src/late.ts"), "untracked mine");
  const context = fakeContext(fake.api);
  await runArtifactPull(context.ctx, { dir: other, theirs: false });
  assert.equal(fs.readFileSync(path.join(other, "src/late.ts"), "utf8"), "untracked mine");
  assert.match(context.said("warn").join(), /src\/late\.ts/);
});

test("pull refuses a folder with other files, a project linked elsewhere, and an empty repo", { skip }, async () => {
  const { fake, id, root } = await pushed();
  const full = scratch();
  fs.writeFileSync(path.join(full, "keep"), "x");
  const context = fakeContext(fake.api);
  await assert.rejects(runArtifactPull(context.ctx, { dir: full, artifact: id, theirs: false }), /already has files/);
  assert.equal(fs.readFileSync(path.join(full, "keep"), "utf8"), "x");

  fake.artifacts.push({ id: 999, organization_id: 7, slug: "other", name: "Other", state: "no_version", active_version_id: null });
  await assert.rejects(runArtifactPull(context.ctx, { dir: root, artifact: "999", theirs: false }), /linked to artifact/);
  await assert.rejects(runArtifactPull(context.ctx, { dir: path.join(scratch(), "new"), artifact: "999", theirs: false }), /source repo is empty/);
  await assert.rejects(runArtifactPull(context.ctx, { dir: scratch(), theirs: false }), /isn't linked to an artifact/);
});
