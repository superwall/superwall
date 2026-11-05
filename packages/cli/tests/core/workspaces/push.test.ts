import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { ApiError, ApiUnreachableError } from "@/core/api/client";
import { readBinding } from "@/core/workspaces/binding";
import { runWorkspacePull } from "@/core/workspaces/pull";
import { runWorkspacePush, slugOfName, waitForBuild, type PushInput } from "@/core/workspaces/push";
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

const run = promisify(execFile);

const teammateGit = (dir: string, secret: string) => {
  remote.tokens.add(secret);
  return (...args: string[]) =>
    run("git", ["-c", `http.extraHeader=Authorization: Bearer ${secret}`, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
};

const noWait = { sleep: async () => undefined, fetchVersion: async () => ({ ok: false, json: async () => ({}) }) };

function project(extra: Record<string, string> = {}): string {
  const root = workspaceProject();
  writeVendoredSdk(root, "0.1.0");
  fs.writeFileSync(path.join(root, "vendor/workspace-sdk/server.mjs"), "export {}\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n.superwall/\n");
  fs.mkdirSync(path.join(root, "node_modules/x"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules/x/index.js"), "ignored");
  fs.mkdirSync(path.join(root, ".superwall"), { recursive: true });
  fs.writeFileSync(path.join(root, ".superwall/local"), "ignored");
  for (const [file, content] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

const input = (root: string, overrides: Partial<PushInput> = {}): PushInput => ({
  dir: root,
  org: "7",
  overwriteSource: false,
  ...overrides,
});

const setup = (options: Partial<Parameters<typeof fakeWorkspaceApi>[0]> = {}) => {
  const fake = fakeWorkspaceApi({ remote, manifest: MANIFEST as never, ...options });
  return { ...fake, ...fakeContext(fake.api) };
};

test("a first push creates the workspace, records it, pushes the tree over real git, and builds", { skip }, async () => {
  const root = project({ "paywalls/x/file.txt": "a workspace's own paywalls/ dir", "superwall.lock": "not a framework lock" });
  const { ctx, workspaces, revoked, apiCalls, said, failed } = setup();
  await runWorkspacePush(ctx, input(root, { m: "First" }), noWait);

  const [workspace] = workspaces;
  assert.equal(workspace?.name, MANIFEST.name);
  assert.equal(workspace?.slug, "test-workspace");
  const repo = `ws-${workspace!.id}`;
  const binding = readBinding(root)!;
  assert.equal(binding.workspaceId, String(workspace!.id));
  assert.equal(binding.organizationId, "7");
  assert.equal(binding.syncedCommit, remote.headOf(repo));

  const files = remote.filesOf(repo);
  for (const expected of ["superwall.json", "src/worker.ts", "vendor/workspace-sdk/server.mjs", "superwall.workspace.json", "paywalls/x/file.txt", "superwall.lock"]) {
    assert.ok(files.includes(expected), `${expected} was pushed`);
  }
  assert.ok(!files.some((file) => file.startsWith("node_modules/") || file.startsWith(".superwall/")));
  assert.equal(remote.show(repo, "superwall.lock"), "not a framework lock");
  assert.doesNotMatch(remote.show(repo, "superwall.workspace.json"), /synced_commit/);

  const message = remote.log(repo);
  assert.match(message, /^push workspace\/test-workspace\n\nFirst\n/);
  assert.match(message, new RegExp(`Superwall-Workspace: ${workspace!.id}`));
  assert.match(message, /Superwall-Workspace-Sdk: 0\.1\.0/);

  assert.deepEqual(revoked, ["tok_1"]);
  assert.ok(apiCalls.includes(`GET /v2/workspaces/${workspace!.id}/versions/101/build`), "it polled the build");
  assert.equal(failed(), 0);
  assert.match(said("success").join(), /Only you can see version 101 until an admin approves it/);
  assert.match(said("info").join(), /Open https:\/\/app\.superwall\.dev\/7\/workspaces\/test-workspace/);
});

test("only the secret goes to git, never the ?expires part or a bare request", { skip }, async () => {
  const root = project();
  const before = remote.requests.length;
  const { ctx } = setup();
  await runWorkspacePush(ctx, input(root), noWait);
  const made = remote.requests.slice(before);
  assert.ok(made.length > 0);
  assert.ok(made.every((request) => request.authorized));
});

test("a second push merges from its sync point and removes a deleted file", { skip }, async () => {
  const root = project({ "src/old.ts": "old" });
  const { ctx, versions } = setup();
  await runWorkspacePush(ctx, input(root), noWait);
  const repo = `ws-${readBinding(root)!.workspaceId}`;
  fs.rmSync(path.join(root, "src/old.ts"));
  fs.writeFileSync(path.join(root, "src/new.ts"), "new");
  await runWorkspacePush(ctx, input(root), noWait);
  const files = remote.filesOf(repo);
  assert.ok(files.includes("src/new.ts"));
  assert.ok(!files.includes("src/old.ts"));
  assert.equal(versions.length, 2);
});

test("pushing nothing new returns the same version, with no new commit and no rebuild of a new version", { skip }, async () => {
  const root = project();
  const { ctx, versions } = setup();
  await runWorkspacePush(ctx, input(root), noWait);
  const repo = `ws-${readBinding(root)!.workspaceId}`;
  const head = remote.headOf(repo);
  await runWorkspacePush(ctx, input(root), noWait);
  assert.equal(remote.headOf(repo), head);
  assert.equal(versions.length, 1);
});

test("a 409 from the build re-mints and pushes again on top of a teammate", { skip }, async () => {
  const root = project();
  const first = setup();
  await runWorkspacePush(first.ctx, input(root), noWait);
  const binding = readBinding(root)!;
  const repo = `ws-${binding.workspaceId}`;

  const teammate = scratch("teammate");
  const git = teammateGit(teammate, "art_v1_teammate");
  await git("clone", "--quiet", remote.remoteOf(repo), ".");

  let raced = false;
  const second = setup({
    onBuilds: async () => {
      if (raced) return;
      raced = true;
      fs.writeFileSync(path.join(teammate, "teammate.txt"), "theirs");
      await git("add", "-A");
      await git("commit", "--quiet", "-m", "teammate");
      await git("pull", "--quiet", "--rebase", "origin", "main");
      await git("push", "--quiet", "origin", "HEAD:main");
    },
  });
  second.workspaces.push({ id: Number(binding.workspaceId), organization_id: 7, slug: binding.slug, name: "x", state: "no_version", active_version_id: null });
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  await runWorkspacePush(second.ctx, input(root), noWait);

  assert.ok(raced);
  const files = remote.filesOf(repo);
  assert.ok(files.includes("teammate.txt"), "their commit survived");
  assert.ok(files.includes("src/mine.ts"), "ours landed");
  assert.deepEqual(second.revoked, ["tok_2"]);
  assert.match(second.said("info").join(), /Someone pushed at the same moment/);
  assert.equal(second.apiCalls.filter((call) => call.endsWith("/source-access")).length, 2);
});

test("a conflict with a teammate tells you to pull, in workspace words", { skip }, async () => {
  const root = project({ "src/shared.ts": "base" });
  const first = setup();
  await runWorkspacePush(first.ctx, input(root), noWait);
  const binding = readBinding(root)!;
  const repo = `ws-${binding.workspaceId}`;
  const teammate = scratch("teammate");
  const git = teammateGit(teammate, "art_v1_teammate2");
  await git("clone", "--quiet", remote.remoteOf(repo), ".");
  fs.writeFileSync(path.join(teammate, "src/shared.ts"), "theirs");
  await git("commit", "--quiet", "-am", "teammate");
  await git("push", "--quiet", "origin", "HEAD:main");

  fs.writeFileSync(path.join(root, "src/shared.ts"), "mine");
  const second = setup();
  await assert.rejects(runWorkspacePush(second.ctx, input(root), noWait), /superwall workspaces pull.*--overwrite-source/s);

  const pulling = setup();
  pulling.workspaces.push({ id: Number(binding.workspaceId), organization_id: 7, slug: binding.slug, name: "x", state: "no_version", active_version_id: null });
  await assert.rejects(runWorkspacePull(pulling.ctx, { dir: root, theirs: false }), /both changed src\/shared\.ts/);
  await runWorkspacePull(pulling.ctx, { dir: root, theirs: true });
  assert.equal(fs.readFileSync(path.join(root, "src/shared.ts"), "utf8"), "theirs");
  const pushing = setup();
  await runWorkspacePush(pushing.ctx, input(root), noWait);
  assert.equal(pushing.failed(), 0);
});

test("with no sync point, a differing source repo is refused, and --overwrite-source replaces all of it", { skip }, async () => {
  const root = project({ "src/shared.ts": "base", "src/extra.ts": "extra" });
  const first = setup();
  await runWorkspacePush(first.ctx, input(root), noWait);
  const binding = readBinding(root)!;
  const repo = `ws-${binding.workspaceId}`;

  const other = project({ "src/shared.ts": "different" });
  fs.writeFileSync(path.join(other, "superwall.workspace.json"), JSON.stringify({ workspace_id: Number(binding.workspaceId), organization_id: 7, slug: binding.slug }));
  const second = setup();
  await assert.rejects(runWorkspacePush(second.ctx, input(other), noWait), /differs from this project.*superwall workspaces pull/s);
  await runWorkspacePush(second.ctx, input(other, { overwriteSource: true }), noWait);
  assert.equal(remote.show(repo, "src/shared.ts"), "different");
  assert.ok(!remote.filesOf(repo).includes("src/extra.ts"), "a file only the repo had is gone");
});

test("a failed build shows the builder's message and fails the command", { skip }, async () => {
  const root = project();
  const { ctx, said, failed, versions } = setup({
    buildSequence: [
      { status: "running", step: "check_source" },
      { status: "failed", step: "check_source", failure: { code: "invalid_config", message: "Bindings are not supported in workspaces (found: kv_namespaces)." } },
    ],
  });
  await runWorkspacePush(ctx, input(root), noWait);
  assert.equal(failed(), 1);
  assert.match(said("error").join(), /The build failed at check_source: Bindings are not supported/);
  assert.match(said("info").join(), /superwall workspaces logs/);
  assert.equal(said("success").some((text) => text.includes("Only you can see")), false);
  assert.equal(versions[0]?.build_status, "FAILED");
});

test("--json carries the outcome either way", { skip }, async () => {
  const root = project();
  const ok = fakeWorkspaceApi({ remote, manifest: MANIFEST as never });
  const good = fakeContext(ok.api, { json: true });
  await runWorkspacePush(good.ctx, input(root), noWait);
  assert.deepEqual(
    Object.keys(good.data[0] as object),
    ["workspace_id", "slug", "version_id", "commit_sha", "source", "status", "step", "failure", "steps", "url"],
  );
  assert.equal((good.data[0] as { status: string }).status, "succeeded");

  const failing = fakeWorkspaceApi({
    remote,
    buildSequence: [{ status: "failed", failure: { code: "bundle_failed", message: "no" } }],
  });
  const bad = fakeContext(failing.api, { json: true });
  await runWorkspacePush(bad.ctx, input(project()), noWait);
  assert.equal((bad.data[0] as { status: string }).status, "failed");
  assert.equal(bad.failed(), 1);
});

test("a build that outlasts the wait says so and fails, with where to look", { skip }, async () => {
  const root = project();
  let now = 0;
  const { ctx, said, failed } = setup({ buildSequence: [{ status: "running", step: "install" }] });
  await runWorkspacePush(ctx, input(root), {
    ...noWait,
    sleep: async () => {
      now += 10 * 60 * 1000;
    },
    now: () => now,
  });
  assert.equal(failed(), 1);
  assert.match(said("warn").join(), /superwall workspaces status/);
  const json = fakeWorkspaceApi({ remote, buildSequence: [{ status: "running", step: "install" }] });
  const context = fakeContext(json.api, { json: true });
  await runWorkspacePush(context.ctx, input(project()), {
    ...noWait,
    sleep: async () => {
      now += 10 * 60 * 1000;
    },
    now: () => now,
  });
  assert.equal((context.data[0] as { status: string }).status, "running");
  assert.equal(context.failed(), 1);
});

test("it runs the vendored SDK check first, and doesn't push without git", async () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "0.1.0");
  const { ctx, said } = fakeContext({} as never);
  await assert.rejects(
    runWorkspacePush(ctx, input(root), {
      fetchVersion: async () => ({ ok: true, json: async () => ({ version: "0.2.0" }) }),
      hasGit: async () => false,
    }),
    /Install git/,
  );
  assert.match(said("warn").join(), /0\.1\.0, and 0\.2\.0 is out.*superwall workspaces update/);
});

test("an existing workspace of the same slug is reused, and a create race falls back to it", { skip }, async () => {
  const fake = setup();
  fake.workspaces.push({ id: 900, organization_id: 7, slug: "test-workspace", name: "Theirs", state: "no_version", active_version_id: null });
  const root = project();
  await runWorkspacePush(fake.ctx, input(root), noWait);
  assert.equal(readBinding(root)?.workspaceId, "900");
  assert.match(fake.said("info").join(), /Using the existing workspace/);

  const racing = setup();
  const post = racing.api.post.bind(racing.api);
  racing.api.post = (async (route: string, body: unknown) => {
    if (route === "/v2/workspaces") {
      racing.workspaces.push({ id: 901, organization_id: 7, slug: "test-workspace", name: "Theirs", state: "no_version", active_version_id: null });
      throw new ApiError("POST", 409, JSON.stringify({ message: "taken" }));
    }
    return post(route, body);
  }) as never;
  const raced = project();
  await runWorkspacePush(racing.ctx, input(raced), noWait);
  assert.equal(readBinding(raced)?.workspaceId, "901");

  const refusing = setup();
  refusing.api.post = (async () => {
    throw new ApiError("POST", 403, JSON.stringify({ message: "Workspaces are not enabled for this organization." }));
  }) as never;
  await assert.rejects(runWorkspacePush(refusing.ctx, input(project()), noWait), /not enabled/);
});

test("polling rides out a passing outage and gives up on a real error", async () => {
  const started = { workspace_id: 1, version_id: 2, status: "queued" } as never;
  let reads = 0;
  const flaky = {
    get: async () => {
      reads += 1;
      if (reads < 3) throw new ApiUnreachableError("https://x", new Error("down"));
      return { workspace_id: 1, version_id: 2, status: "succeeded" };
    },
  } as never;
  const progress: unknown[] = [];
  const wait = await waitForBuild(flaky, started, { sleep: async () => undefined }, (build) => progress.push(build.status));
  assert.equal(wait.finished, true);
  assert.equal(progress.at(-1), "succeeded");

  const refused = { get: async () => { throw new ApiError("GET", 403, JSON.stringify({ message: "no" })); } } as never;
  await assert.rejects(waitForBuild(refused, started, { sleep: async () => undefined }, () => {}), /no/);
  const down = { get: async () => { throw new ApiError("GET", 503, JSON.stringify({ message: "builder down" })); } } as never;
  await assert.rejects(waitForBuild(down, started, { sleep: async () => undefined }, () => {}), /builder down/);
});

test("names become slugs the API accepts", () => {
  assert.equal(slugOfName("Subscription health"), "subscription-health");
  assert.equal(slugOfName("  Churn & Copilot!! "), "churn-copilot");
  assert.equal(slugOfName("2026 report"), "ws-2026-report");
  assert.equal(slugOfName("A"), "ws-a");
  assert.equal(slugOfName("!!!"), "ws-workspace");
  assert.match(slugOfName("x".repeat(90)), /^x{63}$/);
});
