import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { applyPulledChanges, appsToPull, boundPaywall, mergePulledLock } from "@/core/paywalls/pull";
import { formatLock, NewerLockError, type LockFile } from "@/core/paywalls/project/lock";
import { PullConflictError, pullSourceTree } from "@/core/paywalls/source/git";
import type { SourceFile } from "@/core/paywalls/source/source";
import { silentRenderer, useRenderer } from "@/ui";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const dirs: string[] = [];

const temp = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function bareRepo(): { remote: string; dir: string } {
  const dir = temp("superwall-pull-bare-");
  execFileSync("git", ["init", "--bare", "--initial-branch", "main", dir]);
  return { remote: `file://${dir}`, dir };
}

const access = (remote: string) => ({
  repo: "org1-app42",
  remote,
  branch: "main",
  token: "art_v1_deadbeefcafebabe?expires=1790000000",
  tokenId: "tok_1",
});

const file = (relative: string, content: string): SourceFile => ({ path: relative, content: Buffer.from(content) });

function commit(repo: { remote: string }, files: Record<string, string | null>): string {
  const work = temp("superwall-pull-seed-");
  execFileSync("git", ["clone", "--quiet", repo.remote, work], { stdio: "ignore" });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(work, relative);
    if (content === null) fs.rmSync(target);
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", work, "-c", "user.name=Jom", "-c", "user.email=j@example.com", "-c", "commit.gpgsign=false", ...args],
      { encoding: "utf8" },
    );
  git("add", "-A");
  git("commit", "--quiet", "-m", "teammate");
  git("push", "--quiet", "origin", "HEAD:main");
  return git("rev-parse", "HEAD").trim();
}

const contentOf = (changes: { path: string; content: Buffer | undefined }[], relative: string) => {
  const change = changes.find((entry) => entry.path === relative);
  assert.ok(change, `${relative} is among the changes`);
  return change.content?.toString("utf8");
};

const lock = (over: Partial<LockFile> = {}): LockFile => ({
  version: 1,
  apps: { ios: "42" },
  paywalls: {},
  funnels: {},
  ...over,
});

test("an empty source repo has nothing to pull", async () => {
  const repo = bareRepo();
  const pulled = await pullSourceTree({ access: access(repo.remote), files: [file("config.ts", "x\n")] });
  assert.deepEqual(pulled, { status: "empty" });
});

test("from a sync point, a teammate's change arrives and your own edits are left alone", async () => {
  const repo = bareRepo();
  const base = commit(repo, { "paywalls/a/index.tsx": "a1\n", "paywalls/b/index.tsx": "b1\n" });
  const head = commit(repo, { "paywalls/b/index.tsx": "b2\n", "paywalls/b/extra.ts": "new\n" });

  const pulled = await pullSourceTree({
    access: access(repo.remote),
    base,
    files: [file("paywalls/a/index.tsx", "a-mine\n"), file("paywalls/b/index.tsx", "b1\n")],
  });

  assert.equal(pulled.status, "pulled");
  if (pulled.status !== "pulled") return;
  assert.equal(pulled.head, head);
  assert.deepEqual(
    pulled.changes.map((change) => change.path),
    ["paywalls/b/extra.ts", "paywalls/b/index.tsx"],
  );
  assert.equal(contentOf(pulled.changes, "paywalls/b/index.tsx"), "b2\n");
});

test("a file the teammate deleted since the sync point is deleted here too", async () => {
  const repo = bareRepo();
  const base = commit(repo, { "paywalls/b/index.tsx": "b1\n", "paywalls/b/old.ts": "old\n" });
  commit(repo, { "paywalls/b/old.ts": null });

  const pulled = await pullSourceTree({
    access: access(repo.remote),
    base,
    files: [file("paywalls/b/index.tsx", "b1\n"), file("paywalls/b/old.ts", "old\n")],
  });

  assert.ok(pulled.status === "pulled");
  assert.deepEqual(pulled.changes, [{ path: "paywalls/b/old.ts", content: undefined }]);
});

test("with no sync point, the remote's paywalls join yours and nothing of yours is touched", async () => {
  const repo = bareRepo();
  commit(repo, { "paywalls/b/index.tsx": "b\n", "config.ts": "shared\n" });

  const pulled = await pullSourceTree({
    access: access(repo.remote),
    files: [file("paywalls/a/index.tsx", "a\n"), file("config.ts", "shared\n")],
  });

  assert.ok(pulled.status === "pulled");
  assert.deepEqual(
    pulled.changes.map((change) => change.path),
    ["paywalls/b/index.tsx"],
  );
});

test("a file both sides changed is refused, naming only that file, unless --theirs takes the remote's", async () => {
  const repo = bareRepo();
  commit(repo, { "paywalls/a/index.tsx": "jom v3\n", "paywalls/b/index.tsx": "b\n" });
  const files = [file("paywalls/a/index.tsx", "nick v2\n")];

  await assert.rejects(
    pullSourceTree({ access: access(repo.remote), files }),
    (error: unknown) =>
      error instanceof PullConflictError &&
      error.files.join() === "paywalls/a/index.tsx" &&
      /--theirs/.test(error.message),
  );

  const pulled = await pullSourceTree({ access: access(repo.remote), files, theirs: true });
  assert.ok(pulled.status === "pulled");
  assert.equal(contentOf(pulled.changes, "paywalls/a/index.tsx"), "jom v3\n");
  assert.equal(contentOf(pulled.changes, "paywalls/b/index.tsx"), "b\n");
});

test("--theirs takes a teammate's deletion over your edit of the same file", async () => {
  const repo = bareRepo();
  const base = commit(repo, { "paywalls/b/index.tsx": "b1\n", "paywalls/b/gone.ts": "g1\n" });
  commit(repo, { "paywalls/b/gone.ts": null });
  const files = [file("paywalls/b/index.tsx", "b1\n"), file("paywalls/b/gone.ts", "mine\n")];

  await assert.rejects(pullSourceTree({ access: access(repo.remote), base, files }), PullConflictError);
  const pulled = await pullSourceTree({ access: access(repo.remote), base, files, theirs: true });
  assert.ok(pulled.status === "pulled");
  assert.deepEqual(pulled.changes, [{ path: "paywalls/b/gone.ts", content: undefined }]);
});

test("the lock and the types never conflict: they come back separately, never as file changes", async () => {
  const repo = bareRepo();
  const remoteLock = formatLock(lock({ paywalls: { b: { ios: { paywallId: "2", snapshot: "s" } } } }));
  commit(repo, { "superwall.lock": remoteLock, "superwall.d.ts": "theirs\n", "paywalls/b/index.tsx": "b\n" });

  const pulled = await pullSourceTree({
    access: access(repo.remote),
    files: [
      file("superwall.lock", formatLock(lock({ paywalls: { a: { ios: { paywallId: "1" } } } }))),
      file("superwall.d.ts", "mine\n"),
    ],
  });

  assert.ok(pulled.status === "pulled");
  assert.equal(pulled.lock, remoteLock);
  assert.deepEqual(
    pulled.changes.map((change) => change.path),
    ["paywalls/b/index.tsx"],
  );
});

test("a sync point the remote never had falls back to an unrelated merge", async () => {
  const repo = bareRepo();
  commit(repo, { "paywalls/b/index.tsx": "b\n" });

  const pulled = await pullSourceTree({
    access: access(repo.remote),
    base: "f".repeat(40),
    files: [file("paywalls/a/index.tsx", "a\n")],
  });

  assert.ok(pulled.status === "pulled");
  assert.deepEqual(
    pulled.changes.map((change) => change.path),
    ["paywalls/b/index.tsx"],
  );
});

test("a git failure that isn't a conflict surfaces instead of reading as up to date", async () => {
  await assert.rejects(
    pullSourceTree({ access: access(`file://${temp("superwall-not-a-repo-")}/missing`), files: [] }),
    /git clone failed/,
  );
});

test("appsToPull groups platforms by app and honours --platform", () => {
  const both = lock({ apps: { ios: "42", web: "42", android: "7" } });
  assert.deepEqual(appsToPull(both, []), [
    { applicationId: "42", platforms: ["ios", "web"] },
    { applicationId: "7", platforms: ["android"] },
  ]);
  assert.deepEqual(appsToPull(both, ["android"]), [{ applicationId: "7", platforms: ["android"] }]);
  assert.throws(() => appsToPull(both, ["tvos"]), /"tvos" is not a platform/);
});

test("boundPaywall finds any paywall or funnel bound on the app's platforms", () => {
  const bound = lock({
    paywalls: { a: { web: { paywallId: "11" } } },
    funnels: { f: { ios: { paywallId: "22" } } },
  });
  assert.equal(boundPaywall(bound, ["ios"]), "22");
  assert.equal(boundPaywall(bound, ["web"]), "11");
  assert.equal(boundPaywall(bound, ["android"]), undefined);
});

test("the pulled lock takes the teammate's bindings, keeps yours where they differ, and keeps your sync points", () => {
  const local = lock({
    apps: { ios: "42" },
    paywalls: {
      mine: { ios: { paywallId: "1", snapshot: "m1" } },
      shared: { ios: { paywallId: "2", snapshot: "old" } },
      pending: { ios: { paywallId: "3", snapshot: "p-local", sourcePending: 4 } },
      rebound: { ios: { paywallId: "4", snapshot: "r-local" } },
    },
    origins: { "paywall/mine": { paywallId: "1", url: "u1" } },
    sources: { "org1-app42": "a".repeat(40) },
  });
  const remote = lock({
    apps: { ios: "99", android: "7" },
    paywalls: {
      shared: { ios: { paywallId: "2", snapshot: "new" }, android: { paywallId: "5", snapshot: "s5" } },
      pending: { ios: { paywallId: "3", snapshot: "p-remote" } },
      rebound: { ios: { paywallId: "40", snapshot: "r-remote" } },
      theirs: { ios: { paywallId: "6", snapshot: "t" } },
    },
    funnels: { flow: { ios: { paywallId: "8" } } },
    origins: { "paywall/theirs": { paywallId: "6", url: "u6" } },
  });

  const merged = mergePulledLock(local, formatLock(remote));

  assert.deepEqual(merged.apps, { ios: "42", android: "7" });
  assert.deepEqual(merged.paywalls, {
    shared: { ios: { paywallId: "2", snapshot: "new" }, android: { paywallId: "5", snapshot: "s5" } },
    pending: { ios: { paywallId: "3", snapshot: "p-local", sourcePending: 4 } },
    rebound: { ios: { paywallId: "4", snapshot: "r-local" } },
    theirs: { ios: { paywallId: "6", snapshot: "t" } },
    mine: { ios: { paywallId: "1", snapshot: "m1" } },
  });
  assert.deepEqual(merged.funnels, { flow: { ios: { paywallId: "8" } } });
  assert.deepEqual(merged.origins, {
    "paywall/theirs": { paywallId: "6", url: "u6" },
    "paywall/mine": { paywallId: "1", url: "u1" },
  });
  assert.deepEqual(merged.sources, { "org1-app42": "a".repeat(40) });
});

test("a missing remote lock keeps yours; an unreadable one keeps yours and says so; a newer one stops", () => {
  const local = lock({ paywalls: { a: { ios: { paywallId: "1" } } } });
  assert.equal(mergePulledLock(local, undefined), local);

  const calls: RendererCall[] = [];
  useRenderer(recordingRenderer(calls));
  try {
    assert.equal(mergePulledLock(local, "{ not json"), local);
  } finally {
    useRenderer(silentRenderer);
  }
  assert.match(
    calls.filter((call) => call.method === "warn").map((call) => String(call.value)).join(),
    /can't be read .* kept your bindings/,
  );

  assert.throws(() => mergePulledLock(local, JSON.stringify({ version: 2 })), NewerLockError);
});

test("pulled changes are written and deleted, but never over a local file the project ignores", () => {
  const dir = temp("superwall-pull-apply-");
  fs.mkdirSync(path.join(dir, "paywalls", "b"), { recursive: true });
  fs.writeFileSync(path.join(dir, "paywalls", "b", "old.ts"), "old\n");
  fs.writeFileSync(path.join(dir, "secret.local"), "keep\n");

  const result = applyPulledChanges(
    dir,
    [
      { path: "paywalls/b/index.tsx", content: Buffer.from("b\n") },
      { path: "paywalls/b/old.ts", content: undefined },
      { path: "secret.local", content: Buffer.from("theirs\n") },
    ],
    new Set(["paywalls/b/old.ts"]),
  );

  assert.deepEqual(result, { written: ["paywalls/b/index.tsx", "paywalls/b/old.ts"], skipped: ["secret.local"] });
  assert.equal(fs.readFileSync(path.join(dir, "paywalls", "b", "index.tsx"), "utf8"), "b\n");
  assert.equal(fs.existsSync(path.join(dir, "paywalls", "b", "old.ts")), false);
  assert.equal(fs.readFileSync(path.join(dir, "secret.local"), "utf8"), "keep\n");
});

test("a symlink in the source repo is refused rather than followed", async () => {
  const repo = bareRepo();
  const work = temp("superwall-pull-link-");
  execFileSync("git", ["clone", "--quiet", repo.remote, work], { stdio: "ignore" });
  fs.symlinkSync("/etc/hosts", path.join(work, "hosts"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", work, "-c", "user.name=J", "-c", "user.email=j@e.com", "-c", "commit.gpgsign=false", ...args]);
  git("add", "-A");
  git("commit", "--quiet", "-m", "link");
  git("push", "--quiet", "origin", "HEAD:main");

  await assert.rejects(pullSourceTree({ access: access(repo.remote), files: [] }), /hosts as a symlink/);
});
