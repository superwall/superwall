import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { ApiError, ApiUnreachableError } from "@/core/api/client";
import { readBinding } from "@/core/workspaces/binding";
import { runWorkspacePull } from "@/core/workspaces/pull";
import { namesOf, runWorkspacePush, slugOfName, waitForBuild, type PushInput } from "@/core/workspaces/push";
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
  await runWorkspacePush(second.ctx, input(root, { acceptMergedCommits: true }), noWait);

  assert.ok(raced);
  const files = remote.filesOf(repo);
  assert.ok(files.includes("teammate.txt"), "their commit survived");
  assert.ok(files.includes("src/mine.ts"), "ours landed");
  assert.deepEqual(second.revoked, ["tok_2"]);
  assert.match(second.said("info").join(), /Someone pushed at the same moment/);
  assert.equal(second.apiCalls.filter((call) => call.endsWith("/source-access")).length, 2);
});

test("a token that ran out or was used is minted again, and says so", { skip }, async () => {
  const root = project();
  let refused = false;
  const run = setup({
    onBuilds: () => {
      if (refused) return;
      refused = true;
      throw new ApiError("POST builds", 409, JSON.stringify({ message: "This push's token has expired. Push again." }));
    },
  });
  await runWorkspacePush(run.ctx, input(root), noWait);
  assert.equal(run.failed(), 0);
  assert.equal(run.apiCalls.filter((call) => call.endsWith("/source-access")).length, 2);
  assert.match(run.said("info").join(), /This push's token ran out\. Pushing again\./);
  assert.equal(run.versions.length, 1);
});

test("token_id goes back exactly as it came, however long and odd", { skip }, async () => {
  const opaque = `v1.${"aZ09+/=_-".repeat(56)}`.slice(0, 512);
  const root = project();
  const run = setup({ tokenIdOf: () => opaque });
  await runWorkspacePush(run.ctx, input(root), noWait);
  assert.deepEqual(run.revoked, [opaque]);
});

test("a 403 from the build stops, with the API's words and no second try", { skip }, async () => {
  const root = project();
  const message = "This token_id wasn't issued to you for this workspace.";
  const run = setup({
    onBuilds: () => {
      throw new ApiError("POST builds", 403, JSON.stringify({ message }));
    },
  });
  await assert.rejects(runWorkspacePush(run.ctx, input(root), noWait), new RegExp(message));
  assert.equal(run.apiCalls.filter((call) => call.endsWith("/source-access")).length, 1);
});

test("a member who can't build sees why, before anything is pushed", { skip }, async () => {
  const root = project();
  const message = "Building a workspace needs access to all projects, because a workspace reaches every project. Ask an owner or admin to change your project access.";
  const fake = setup();
  const { api } = fake;
  const post = api.post.bind(api);
  api.post = (async (route: string, body: never) => {
    if (route.endsWith("/source-access")) throw new ApiError("POST source-access", 403, JSON.stringify({ message }));
    return post(route, body);
  }) as never;
  await assert.rejects(runWorkspacePush(fake.ctx, input(root), noWait), new RegExp(message));
  assert.equal(fake.apiCalls.filter((call) => call.endsWith("/builds")).length, 0);
});

test("a full organization waits and repeats the same call: no new push and no new token", { skip }, async () => {
  const root = project();
  const message = "This organization already has 3 builds running. Try again when one finishes.";
  let refusals = 2;
  const waits: number[] = [];
  const run = setup({
    tokenIdOf: (mint) => `opaque-${mint}`,
    onBuilds: () => {
      if (refusals <= 0) return;
      refusals -= 1;
      throw new ApiError("POST builds", 429, JSON.stringify({ message, retry_after: 60 }));
    },
  });
  const repo = () => `ws-${readBinding(root)!.workspaceId}`;
  await runWorkspacePush(run.ctx, input(root), {
    ...noWait,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(waits.slice(0, 2), [60_000, 60_000]);
  assert.equal(run.apiCalls.filter((call) => call.endsWith("/builds")).length, 3);
  assert.equal(run.apiCalls.filter((call) => call.endsWith("/source-access")).length, 1, "no re-push");
  assert.deepEqual(run.revoked, ["opaque-1"]);
  assert.ok(remote.headOf(repo()));
  const told = run.said("info").filter((text) => text.includes(message));
  assert.equal(told.length, 1, "told once, however long it waits");
  assert.match(told[0]!, /keep trying on its own, with nothing to push again/);
  assert.equal(run.failed(), 0);
});

test("a 429 with no usable retry_after still waits a minute", { skip }, async () => {
  for (const body of [JSON.stringify({ message: "Busy" }), "not json"]) {
    let refused = false;
    const waits: number[] = [];
    const run = setup({
      onBuilds: () => {
        if (refused) return;
        refused = true;
        throw new ApiError("POST builds", 429, body);
      },
    });
    await runWorkspacePush(run.ctx, input(project()), { ...noWait, sleep: async (ms) => void waits.push(ms) });
    assert.equal(waits[0], 60_000);
  }
});

test("a full organization that stays full gives up after 20 minutes, and says the source is pushed", { skip }, async () => {
  const root = project();
  let clock = 0;
  const run = setup({
    onBuilds: () => {
      throw new ApiError("POST builds", 429, JSON.stringify({ message: "This organization already has 3 builds running.", retry_after: 60 }));
    },
  });
  await assert.rejects(
    runWorkspacePush(run.ctx, input(root), {
      ...noWait,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    }),
    /3 builds running\. There's still no room after 20 minutes\. Your source is pushed/,
  );
  assert.equal(run.apiCalls.filter((call) => call.endsWith("/source-access")).length, 1);
});

test("the daily limit says trying soon won't help, and doesn't wait", { skip }, async () => {
  const root = project();
  const waits: number[] = [];
  const run = setup({
    onBuilds: () => {
      throw new ApiError("POST builds", 429, JSON.stringify({ message: "This workspace has had 100 pushes in the last day, which is the limit. Try again later.", retry_after: 3600 }));
    },
  });
  await assert.rejects(
    runWorkspacePush(run.ctx, input(root), { ...noWait, sleep: async (ms) => void waits.push(ms) }),
    /100 pushes in the last day.*Trying again soon won't help.*Your source is pushed/,
  );
  assert.deepEqual(waits, []);
  assert.equal(run.apiCalls.filter((call) => call.endsWith("/builds")).length, 1);
});

test("a build with no machine says to push again, not to read a log", { skip }, async () => {
  for (const failure of [
    { code: "busy", message: "All the build machines are busy. Try again in a few minutes." },
    { code: "unavailable", message: "The build container did not start. This is usually temporary, so try again in a few minutes." },
  ]) {
    const run = setup({ buildSequence: [{ status: "failed", step: "start", failure }] });
    await runWorkspacePush(run.ctx, input(project()), noWait);
    assert.equal(run.failed(), 1);
    assert.ok(run.said("error").join().includes(failure.message));
    assert.match(run.said("info").join(), /push` again in a few minutes, and it retries this version/);
    assert.doesNotMatch(run.said("info").join(), /workspaces logs/);
  }
});

const linkedSetup = (root: string, options: Parameters<typeof setup>[0] = {}, context: Parameters<typeof fakeContext>[1] = {}) => {
  const binding = readBinding(root)!;
  const fake = fakeWorkspaceApi({ remote, manifest: MANIFEST as never, ...options });
  fake.workspaces.push({ id: Number(binding.workspaceId), organization_id: 7, slug: binding.slug, name: "x", state: "no_version", active_version_id: null });
  return { ...fake, ...fakeContext(fake.api, context), repo: `ws-${binding.workspaceId}` };
};

async function teammateCommit(root: string, file: string, identity = "Alex Teammate", message = `Add ${file}`) {
  const repo = `ws-${readBinding(root)!.workspaceId}`;
  const dir = scratch("teammate");
  const git = teammateGit(dir, "art_v1_merged");
  await git("clone", "--quiet", remote.remoteOf(repo), ".");
  fs.writeFileSync(path.join(dir, file), "theirs");
  await git("add", "-A");
  await git("-c", `user.name=${identity}`, "-c", `user.email=${identity.toLowerCase().replace(/\s+/g, ".")}@example.com`, "commit", "--quiet", "-m", message);
  await git("push", "--quiet", "origin", "HEAD:main");
  return (await git("rev-parse", "HEAD")).stdout.trim();
}

async function pushedOnce(extra: Record<string, string> = {}): Promise<string> {
  const root = project(extra);
  await runWorkspacePush(setup().ctx, input(root), noWait);
  return root;
}

test("a workspace commit is authored by the person signed in, whatever git's environment says", { skip }, async () => {
  const root = project();
  const previous = { name: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL };
  process.env.GIT_AUTHOR_NAME = "Somebody Else";
  process.env.GIT_AUTHOR_EMAIL = "else@example.com";
  try {
    await runWorkspacePush(setup({ me: { name: "Pat Pusher", email: "pat@example.com" } }).ctx, input(root), noWait);
  } finally {
    if (previous.name === undefined) delete process.env.GIT_AUTHOR_NAME;
    else process.env.GIT_AUTHOR_NAME = previous.name;
    if (previous.email === undefined) delete process.env.GIT_AUTHOR_EMAIL;
    else process.env.GIT_AUTHOR_EMAIL = previous.email;
  }
  const repo = `ws-${readBinding(root)!.workspaceId}`;
  assert.equal(remote.authorOf(repo), "Pat Pusher <pat@example.com>");
});

test("with no name it signs commits with the email, and with no email it falls back to git's own", { skip }, async () => {
  const named = project();
  await runWorkspacePush(setup({ me: { name: null, email: "pat@example.com" } }).ctx, input(named), noWait);
  assert.equal(remote.authorOf(`ws-${readBinding(named)!.workspaceId}`), "pat@example.com <pat@example.com>");
  const unnamed = project();
  await runWorkspacePush(setup({ me: { name: "Pat", email: null } }).ctx, input(unnamed), noWait);
  assert.equal(remote.authorOf(`ws-${readBinding(unnamed)!.workspaceId}`), "Superwall <publish@superwall.com>");
});

test("without a terminal, merging a teammate's commit stops, pushes nothing and changes nothing", { skip }, async () => {
  const root = await pushedOnce();
  const sha = await teammateCommit(root, "theirs.txt");
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  const before = fs.readFileSync(path.join(root, "superwall.workspace.json"), "utf8");
  const run = linkedSetup(root);
  await runWorkspacePush(run.ctx, input(root), noWait);

  assert.equal(remote.headOf(run.repo), sha, "the source repo didn't move");
  assert.equal(fs.readFileSync(path.join(root, "superwall.workspace.json"), "utf8"), before);
  assert.equal(run.failed(), 1);
  assert.equal(run.apiCalls.filter((call) => call.endsWith("/builds")).length, 0, "no build started");
  assert.match(run.said("error").join(), /Your copy would run commits from Alex Teammate with your reads/);
  assert.match(run.said("error").join(), /--accept-merged-commits/);
  assert.match(run.said("report").join(), new RegExp(`${sha.slice(0, 12)} Alex Teammate: Add theirs\\.txt`));
});

test("--json refuses the same way, and carries the commits", { skip }, async () => {
  const root = await pushedOnce();
  const sha = await teammateCommit(root, "theirs.txt");
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  const run = linkedSetup(root, {}, { json: true });
  await runWorkspacePush(run.ctx, input(root), noWait);
  assert.equal(run.failed(), 1);
  assert.equal(remote.headOf(run.repo), sha);
  const [answer] = run.data as [{ pushed: boolean; reason: string; merged_commits: { sha: string; author: string; email: string }[] }];
  assert.equal(answer.pushed, false);
  assert.equal(answer.reason, "needs_accept_merged_commits");
  assert.deepEqual(answer.merged_commits.map((commit) => [commit.sha, commit.author, commit.email]), [[sha, "Alex Teammate", "alex.teammate@example.com"]]);
});

test("at a terminal it asks and says why, and No leaves everything alone", { skip }, async () => {
  const root = await pushedOnce();
  const sha = await teammateCommit(root, "theirs.txt");
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  const declined = linkedSetup(root, {}, { interactive: true, confirm: false });
  await runWorkspacePush(declined.ctx, input(root), noWait);
  assert.match(JSON.stringify(declined.calls.filter((call) => call.method === "confirm")), /Your copy will run commits from Alex Teammate with your reads\./);
  assert.equal(remote.headOf(declined.repo), sha);
  assert.equal(declined.failed(), 0);
  assert.match(declined.said("outro").join(), /Nothing was pushed/);

  const cancelled = linkedSetup(root, {}, { interactive: true, confirm: null });
  await runWorkspacePush(cancelled.ctx, input(root), noWait);
  assert.equal(remote.headOf(cancelled.repo), sha);

  const accepted = linkedSetup(root, {}, { interactive: true, confirm: true });
  await runWorkspacePush(accepted.ctx, input(root), noWait);
  assert.notEqual(remote.headOf(accepted.repo), sha);
  assert.ok(remote.filesOf(accepted.repo).includes("theirs.txt"));
  assert.ok(remote.filesOf(accepted.repo).includes("src/mine.ts"));
  assert.match(accepted.said("warn").join(), /runs commits from Alex Teammate with your reads, and they aren't in this project yet/);
});

test("pushing with no changes of your own still asks: the build would be their commit, as you", { skip }, async () => {
  const root = await pushedOnce();
  const sha = await teammateCommit(root, "theirs.txt");
  const refused = linkedSetup(root);
  await runWorkspacePush(refused.ctx, input(root), noWait);
  assert.equal(refused.failed(), 1);
  assert.equal(refused.apiCalls.filter((call) => call.endsWith("/builds")).length, 0);

  const accepted = linkedSetup(root);
  await runWorkspacePush(accepted.ctx, input(root, { acceptMergedCommits: true }), noWait);
  assert.equal(accepted.versions[0]?.commit_sha, sha);
  assert.equal(accepted.failed(), 0);
});

test("a commit under your own name still asks, because anyone can set a commit's name", { skip }, async () => {
  const root = await pushedOnce();
  await teammateCommit(root, "theirs.txt", "Pat Pusher");
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  const run = linkedSetup(root);
  await runWorkspacePush(run.ctx, input(root), noWait);
  assert.equal(run.failed(), 1);
  assert.match(run.said("report").join(), /Their names come from the commits/);
});

test("it asks once per commit: the next push only asks about newer ones, and a pull settles them", { skip }, async () => {
  const root = await pushedOnce();
  await teammateCommit(root, "first.txt", "Alex Teammate");
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  await runWorkspacePush(linkedSetup(root).ctx, input(root, { acceptMergedCommits: true }), noWait);

  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine again");
  const quiet = linkedSetup(root);
  await runWorkspacePush(quiet.ctx, input(root), noWait);
  assert.equal(quiet.failed(), 0, "the same commits don't ask twice");

  await teammateCommit(root, "second.txt", "Sam Other");
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine a third time");
  const asked = linkedSetup(root);
  await runWorkspacePush(asked.ctx, input(root), noWait);
  assert.equal(asked.failed(), 1);
  assert.match(asked.said("error").join(), /commits from Sam Other with/);
  assert.doesNotMatch(asked.said("error").join(), /Alex/);

  const pulling = linkedSetup(root);
  await runWorkspacePull(pulling.ctx, { dir: root, theirs: false });
  assert.match(pulling.said("info").join(), /your own copy runs all of it with your reads/);
  assert.equal(fs.readFileSync(path.join(root, "second.txt"), "utf8"), "theirs");
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine, after reading");
  const afterPull = linkedSetup(root);
  await runWorkspacePush(afterPull.ctx, input(root), noWait);
  assert.equal(afterPull.failed(), 0);
  assert.doesNotMatch(afterPull.said("warn").join(), /runs commits from/);
});

test("a file a pull couldn't write stays pending: pulling again gets it, and a push can't delete it", { skip }, async () => {
  const root = await pushedOnce();
  const synced = readBinding(root)!.syncedCommit;
  await teammateCommit(root, "blocked.txt");
  fs.appendFileSync(path.join(root, ".gitignore"), "blocked.txt\n");
  fs.writeFileSync(path.join(root, "blocked.txt"), "ignored and mine");

  const first = linkedSetup(root);
  await runWorkspacePull(first.ctx, { dir: root, theirs: false });
  assert.match(first.said("warn").join(), /Not pulled.*blocked\.txt.*Move it, then pull again/);
  assert.equal(readBinding(root)!.syncedCommit, synced, "the sync point stays put");
  assert.equal(fs.readFileSync(path.join(root, "blocked.txt"), "utf8"), "ignored and mine");

  fs.rmSync(path.join(root, "blocked.txt"));
  const second = linkedSetup(root);
  await runWorkspacePull(second.ctx, { dir: root, theirs: false });
  assert.equal(fs.readFileSync(path.join(root, "blocked.txt"), "utf8"), "theirs");
  assert.equal(readBinding(root)!.syncedCommit, remote.headOf(second.repo));
});

test("--overwrite-source replaces a teammate's work knowingly, with nothing to confirm", { skip }, async () => {
  const root = await pushedOnce();
  await teammateCommit(root, "theirs.txt");
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  const run = linkedSetup(root);
  await runWorkspacePush(run.ctx, input(root, { overwriteSource: true }), noWait);
  assert.equal(run.failed(), 0);
  assert.ok(!remote.filesOf(run.repo).includes("theirs.txt"));
  assert.ok(remote.filesOf(run.repo).includes("src/mine.ts"));
});

test("a name can't drive the terminal, and only ten commits are listed", { skip }, async () => {
  const root = await pushedOnce();
  const repo = `ws-${readBinding(root)!.workspaceId}`;
  const dir = scratch("teammate");
  const git = teammateGit(dir, "art_v1_merged");
  await git("clone", "--quiet", remote.remoteOf(repo), ".");
  for (let index = 0; index < 12; index++) {
    fs.writeFileSync(path.join(dir, `file-${index}.txt`), "theirs");
    await git("add", "-A");
    await git("-c", "user.name=Alex\u001b[2JTeammate", "-c", "user.email=alex@example.com", "commit", "--quiet", "-m", `Change\u001b[2J ${index}`);
  }
  await git("push", "--quiet", "origin", "HEAD:main");
  fs.writeFileSync(path.join(root, "src/mine.ts"), "mine");
  const run = linkedSetup(root);
  await runWorkspacePush(run.ctx, input(root), noWait);
  const shown = run.said("report").join() + run.said("error").join();
  assert.doesNotMatch(shown, /\u001b/);
  assert.match(shown, /Alex\[2JTeammate/);
  assert.match(shown, /and 2 more/);
  assert.equal(shown.match(/commits from Alex\[2JTeammate with/g)?.length, 1, "one person, however many commits");
});

test("names read as a list", () => {
  const commit = (author: string, email: string) => ({ sha: "a", author, email, subject: "s" });
  assert.equal(namesOf([commit("A", "a@x"), commit("A", "a@x")]), "A");
  assert.equal(namesOf([commit("A", "a@x"), commit("B", "b@x"), commit("C", "c@x")]), "A, B and C");
  assert.equal(namesOf([commit("", "a@x")]), "a@x");
  assert.equal(namesOf([]), "someone");
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

test("with no sync point, a file only the source repo has is refused too, not quietly built as you", { skip }, async () => {
  const root = await pushedOnce({ "src/shared.ts": "base" });
  const binding = readBinding(root)!;
  await teammateCommit(root, "teammate.ts");

  const fresh = project({ "src/shared.ts": "base" });
  fs.writeFileSync(path.join(fresh, "superwall.workspace.json"), JSON.stringify({ workspace_id: Number(binding.workspaceId), organization_id: 7, slug: binding.slug }));
  const run = linkedSetup(fresh);
  const head = remote.headOf(run.repo);
  await assert.rejects(runWorkspacePush(run.ctx, input(fresh), noWait), /differs from this project in teammate\.ts.*superwall workspaces pull/s);
  assert.equal(remote.headOf(run.repo), head);
  assert.equal(run.apiCalls.filter((call) => call.endsWith("/builds")).length, 0);
});

test("with no sync point, adding files alongside the same source still pushes", { skip }, async () => {
  const root = await pushedOnce({ "src/shared.ts": "base" });
  const binding = readBinding(root)!;
  const fresh = project({ "src/shared.ts": "base", "src/new.ts": "mine" });
  fs.writeFileSync(path.join(fresh, "superwall.workspace.json"), JSON.stringify({ workspace_id: Number(binding.workspaceId), organization_id: 7, slug: binding.slug }));
  const run = linkedSetup(fresh);
  await runWorkspacePush(run.ctx, input(fresh), noWait);
  assert.equal(run.failed(), 0);
  assert.ok(remote.filesOf(run.repo).includes("src/new.ts"));
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
    ["workspace_id", "slug", "version_id", "commit_sha", "source", "status", "step", "failure", "steps", "merged_commits", "url"],
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
