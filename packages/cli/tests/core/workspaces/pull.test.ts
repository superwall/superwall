import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { readBinding } from "@/core/workspaces/binding";
import { runWorkspacePull } from "@/core/workspaces/pull";
import { runWorkspacePush } from "@/core/workspaces/push";
import { hasGitHttpBackend, startLocalGitRemote, type LocalGitRemote } from "../../helpers/git-remote";
import { fakeContext, fakeWorkspaceApi } from "./fake-api";
import { MANIFEST, scratch, workspaceProject, writeVendoredSdk } from "./fixture";

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
  const root = workspaceProject();
  writeVendoredSdk(root, "0.1.0");
  const fake = fakeWorkspaceApi({ remote, manifest: MANIFEST as never });
  const context = fakeContext(fake.api);
  await runWorkspacePush(context.ctx, { dir: root, org: "7", overwriteSource: false }, noWait);
  return { root, fake, context, id: readBinding(root)!.workspaceId };
}

test("pull into an empty folder gets the source and links it", { skip }, async () => {
  const { fake, id } = await pushed();
  const target = path.join(scratch(), "clone");
  const { ctx, said } = fakeContext(fake.api);
  await runWorkspacePull(ctx, { dir: target, workspace: id, theirs: false });
  assert.ok(fs.existsSync(path.join(target, "superwall.json")));
  const binding = readBinding(target)!;
  assert.equal(binding.workspaceId, id);
  assert.equal(binding.syncedCommit, remote.headOf(`ws-${id}`));
  assert.match(said("info").join(), /npm install && superwall workspaces dev/);
});

test("a teammate's push merges with local edits, and pushing after it needs no force", { skip }, async () => {
  const { root, fake, id } = await pushed();
  const clone = path.join(scratch(), "clone");
  const teammate = fakeContext(fake.api);
  await runWorkspacePull(teammate.ctx, { dir: clone, workspace: id, theirs: false });
  fs.writeFileSync(path.join(clone, "src/theirs.ts"), "theirs");
  await runWorkspacePush(teammate.ctx, { dir: clone, overwriteSource: false }, noWait);

  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  const mine = fakeContext(fake.api, { json: true });
  await runWorkspacePull(mine.ctx, { dir: root, theirs: false });
  assert.equal(fs.readFileSync(path.join(root, "src/theirs.ts"), "utf8"), "theirs");
  assert.equal(fs.readFileSync(path.join(root, "src/mine.ts"), "utf8"), "mine");
  assert.deepEqual((mine.data[0] as { written: string[] }).written, ["src/theirs.ts"]);

  const again = fakeContext(fake.api);
  await runWorkspacePull(again.ctx, { dir: root, theirs: false });
  assert.match(again.said("success").join(), /Already up to date/);

  const pushing = fakeContext(fake.api);
  await runWorkspacePush(pushing.ctx, { dir: root, overwriteSource: false }, noWait);
  const files = remote.filesOf(`ws-${id}`);
  assert.ok(files.includes("src/theirs.ts") && files.includes("src/mine.ts"));
});

test("an untracked file in the way is left alone and named", { skip }, async () => {
  const { fake, id } = await pushed();
  const clone = path.join(scratch(), "clone");
  const teammate = fakeContext(fake.api);
  await runWorkspacePull(teammate.ctx, { dir: clone, workspace: id, theirs: false });
  fs.writeFileSync(path.join(clone, "src/late.ts"), "theirs");
  await runWorkspacePush(teammate.ctx, { dir: clone, overwriteSource: false }, noWait);

  const other = path.join(scratch(), "other");
  fs.mkdirSync(path.join(other, "src"), { recursive: true });
  fs.writeFileSync(path.join(other, "superwall.json"), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(other, "superwall.workspace.json"), JSON.stringify({ workspace_id: Number(id), organization_id: 7, slug: "test-workspace" }));
  fs.writeFileSync(path.join(other, ".gitignore"), "src/late.ts\n");
  fs.writeFileSync(path.join(other, "src/late.ts"), "untracked mine");
  const context = fakeContext(fake.api);
  await runWorkspacePull(context.ctx, { dir: other, theirs: false });
  assert.equal(fs.readFileSync(path.join(other, "src/late.ts"), "utf8"), "untracked mine");
  assert.match(context.said("warn").join(), /src\/late\.ts/);
});

test("pull refuses a folder with other files, a project linked elsewhere, and an empty repo", { skip }, async () => {
  const { fake, id, root } = await pushed();
  const full = scratch();
  fs.writeFileSync(path.join(full, "keep"), "x");
  const context = fakeContext(fake.api);
  await assert.rejects(runWorkspacePull(context.ctx, { dir: full, workspace: id, theirs: false }), /already has files/);
  assert.equal(fs.readFileSync(path.join(full, "keep"), "utf8"), "x");

  fake.workspaces.push({ id: 999, organization_id: 7, slug: "other", name: "Other", state: "no_version", active_version_id: null });
  await assert.rejects(runWorkspacePull(context.ctx, { dir: root, workspace: "999", theirs: false }), /linked to workspace/);
  await assert.rejects(runWorkspacePull(context.ctx, { dir: path.join(scratch(), "new"), workspace: "999", theirs: false }), /source repo is empty/);
  await assert.rejects(runWorkspacePull(context.ctx, { dir: scratch(), theirs: false }), /isn't linked to a workspace/);
});
