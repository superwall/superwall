import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  applyPulledChanges,
  appsToPull,
  boundPaywall,
  mergePulledLock,
  pullInto,
  PullPathError,
} from "@/core/paywalls/pull";
import {
  formatLock,
  NewerLockError,
  parseLock,
  readLock,
  writeBinding,
  writeLock,
  writeSnapshot,
  type LockFile,
} from "@/core/paywalls/project/lock";
import { readSourceBase, writeSourceBase } from "@/core/paywalls/source/base";
import { PullConflictError, pullSourceTree, pushSourceTree } from "@/core/paywalls/source/git";
import { withCurrentLock } from "@/core/paywalls/source/source-push";
import { mergeLockText } from "@/core/paywalls/source/scope";
import { collectSourceFiles, type SourceFile } from "@/core/paywalls/source/source";
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

const file = (relative: string, content: string): SourceFile => ({
  path: relative,
  content: Buffer.from(content),
});

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
      [
        "-C",
        work,
        "-c",
        "user.name=Jom",
        "-c",
        "user.email=j@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
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
  const pulled = await pullSourceTree({
    access: access(repo.remote),
    files: [file("config.ts", "x\n")],
  });
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

  await assert.rejects(
    pullSourceTree({ access: access(repo.remote), base, files }),
    PullConflictError,
  );
  const pulled = await pullSourceTree({ access: access(repo.remote), base, files, theirs: true });
  assert.ok(pulled.status === "pulled");
  assert.deepEqual(pulled.changes, [{ path: "paywalls/b/gone.ts", content: undefined }]);
});

test("the lock and the types never conflict: they come back separately, never as file changes", async () => {
  const repo = bareRepo();
  const remoteLock = formatLock(
    lock({ paywalls: { b: { ios: { paywallId: "2", snapshot: "s" } } } }),
  );
  commit(repo, {
    "superwall.lock": remoteLock,
    "superwall.d.ts": "theirs\n",
    "paywalls/b/index.tsx": "b\n",
  });

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
    pullSourceTree({
      access: access(`file://${temp("superwall-not-a-repo-")}/missing`),
      files: [],
    }),
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
    apps: { ios: "42", android: "7" },
    paywalls: {
      shared: {
        ios: { paywallId: "2", snapshot: "new" },
        android: { paywallId: "5", snapshot: "s5" },
      },
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
    shared: {
      ios: { paywallId: "2", snapshot: "new" },
      android: { paywallId: "5", snapshot: "s5" },
    },
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

test("the pulled lock never takes bindings of a different app on a platform, nor of platforms the pull left out", () => {
  const local = lock({
    apps: { ios: "42" },
    paywalls: { mine: { ios: { paywallId: "1" } } },
  });
  const remote = formatLock(
    lock({
      apps: { ios: "99", android: "7", web: "8" },
      paywalls: {
        theirs: { ios: { paywallId: "6" }, android: { paywallId: "5" }, web: { paywallId: "9" } },
        mine: { ios: { paywallId: "60" } },
      },
      funnels: { flow: { ios: { paywallId: "61" } } },
    }),
  );

  const merged = mergePulledLock(local, remote);
  assert.deepEqual(merged.apps, { ios: "42", android: "7", web: "8" });
  assert.deepEqual(merged.paywalls, {
    mine: { ios: { paywallId: "1" } },
    theirs: { android: { paywallId: "5" }, web: { paywallId: "9" } },
  });
  assert.deepEqual(merged.funnels, {});

  const scoped = mergePulledLock(local, remote, ["ios", "web"]);
  assert.deepEqual(scoped.apps, { ios: "42", web: "8" });
  assert.deepEqual(scoped.paywalls, {
    mine: { ios: { paywallId: "1" } },
    theirs: { web: { paywallId: "9" } },
  });
});

test("a pulled path through a symlinked folder, or one that climbs out, is refused before anything is written", () => {
  const dir = temp("superwall-pull-link-dir-");
  const outside = temp("superwall-pull-outside-");
  fs.symlinkSync(outside, path.join(dir, "assets"));
  fs.symlinkSync(path.join(outside, "dangling"), path.join(dir, "link.ts"));

  for (const change of [
    { path: "assets/new.txt", content: Buffer.from("x\n") },
    { path: "link.ts", content: Buffer.from("x\n") },
    { path: "../escape.txt", content: Buffer.from("x\n") },
  ]) {
    assert.throws(
      () =>
        applyPulledChanges(
          dir,
          [{ path: "first.ts", content: Buffer.from("1\n") }, change],
          new Set(),
        ),
      PullPathError,
    );
  }
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(dir, "first.ts")), false);
  assert.equal(fs.existsSync(path.join(path.dirname(dir), "escape.txt")), false);
});

test("a pulled file that became a folder, or a folder that became a file, is applied in order", () => {
  const dir = temp("superwall-pull-shape-");
  fs.writeFileSync(path.join(dir, "theme"), "file\n");
  fs.mkdirSync(path.join(dir, "icons"));
  fs.writeFileSync(path.join(dir, "icons", "a.svg"), "<svg/>\n");

  const result = applyPulledChanges(
    dir,
    [
      { path: "icons", content: Buffer.from("now a file\n") },
      { path: "theme/colors.ts", content: Buffer.from("colors\n") },
      { path: "icons/a.svg", content: undefined },
      { path: "theme", content: undefined },
    ],
    new Set(["theme", "icons/a.svg"]),
  );

  assert.deepEqual(result.written, ["icons", "icons/a.svg", "theme", "theme/colors.ts"]);
  assert.equal(fs.readFileSync(path.join(dir, "icons"), "utf8"), "now a file\n");
  assert.equal(fs.readFileSync(path.join(dir, "theme", "colors.ts"), "utf8"), "colors\n");
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
    calls
      .filter((call) => call.method === "warn")
      .map((call) => String(call.value))
      .join(),
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

  assert.deepEqual(result, {
    written: ["paywalls/b/index.tsx", "paywalls/b/old.ts"],
    skipped: ["secret.local"],
  });
  assert.equal(fs.readFileSync(path.join(dir, "paywalls", "b", "index.tsx"), "utf8"), "b\n");
  assert.equal(fs.existsSync(path.join(dir, "paywalls", "b", "old.ts")), false);
  assert.equal(fs.readFileSync(path.join(dir, "secret.local"), "utf8"), "keep\n");
});

test("a pulled file under a folder an ignored local file blocks is skipped, and nothing else is lost", () => {
  const dir = temp("superwall-pull-apply-");
  fs.writeFileSync(path.join(dir, "assets"), "ignored local file\n");
  fs.writeFileSync(path.join(dir, "old.ts"), "old\n");
  fs.writeFileSync(path.join(dir, "theme"), "tracked file\n");

  const result = applyPulledChanges(
    dir,
    [
      { path: "old.ts", content: undefined },
      { path: "theme", content: undefined },
      { path: "assets/new.svg", content: Buffer.from("<svg/>") },
      { path: "theme/colors.ts", content: Buffer.from("colors\n") },
    ],
    new Set(["old.ts", "theme"]),
  );

  assert.deepEqual(result, {
    written: ["old.ts", "theme", "theme/colors.ts"],
    skipped: ["assets/new.svg"],
  });
  assert.equal(fs.readFileSync(path.join(dir, "assets"), "utf8"), "ignored local file\n");
  assert.equal(fs.existsSync(path.join(dir, "old.ts")), false);
  assert.equal(fs.readFileSync(path.join(dir, "theme", "colors.ts"), "utf8"), "colors\n");
});

test("--theirs resolves a conflicting file named like a git pathspec without touching other files", async () => {
  const repo = bareRepo();
  const tricky = ":(glob)shared/*.txt";
  commit(repo, { [tricky]: "theirs\n", "shared/other.txt": "remote other\n" });
  const files = [file(tricky, "mine\n"), file("shared/other.txt", "remote other\n")];

  const pulled = await pullSourceTree({ access: access(repo.remote), files, theirs: true });
  assert.ok(pulled.status === "pulled");
  assert.equal(contentOf(pulled.changes, tricky), "theirs\n");
  assert.equal(
    pulled.changes.some((change) => change.path === "shared/other.txt"),
    false,
  );
});

test("a symlink in the source repo is refused rather than followed", async () => {
  const repo = bareRepo();
  const work = temp("superwall-pull-link-");
  execFileSync("git", ["clone", "--quiet", repo.remote, work], { stdio: "ignore" });
  fs.symlinkSync("/etc/hosts", path.join(work, "hosts"));
  const git = (...args: string[]) =>
    execFileSync("git", [
      "-C",
      work,
      "-c",
      "user.name=J",
      "-c",
      "user.email=j@e.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ]);
  git("add", "-A");
  git("commit", "--quiet", "-m", "link");
  git("push", "--quiet", "origin", "HEAD:main");

  await assert.rejects(
    pullSourceTree({ access: access(repo.remote), files: [] }),
    /hosts as a symlink/,
  );
});

test("a pull returns the lock at the sync point, and none without one", async () => {
  const repo = bareRepo();
  const syncedLock = formatLock(
    lock({ paywalls: { a: { ios: { paywallId: "1", snapshot: "s1" } } } }),
  );
  const base = commit(repo, { "superwall.lock": syncedLock, "paywalls/a/index.tsx": "a\n" });
  commit(repo, {
    "superwall.lock": formatLock(
      lock({ paywalls: { a: { ios: { paywallId: "1", snapshot: "s2" } } } }),
    ),
  });

  const synced = await pullSourceTree({ access: access(repo.remote), files: [], base });
  assert.ok(synced.status === "pulled");
  assert.equal(synced.baseLock, syncedLock);

  const unsynced = await pullSourceTree({ access: access(repo.remote), files: [] });
  assert.ok(unsynced.status === "pulled");
  assert.equal(unsynced.baseLock, undefined);
});

test("a sync point whose commit has no lock gives no base lock", async () => {
  const repo = bareRepo();
  const base = commit(repo, { "paywalls/a/index.tsx": "a\n" });
  commit(repo, { "superwall.lock": formatLock(lock()) });

  const pulled = await pullSourceTree({ access: access(repo.remote), files: [], base });
  assert.ok(pulled.status === "pulled");
  assert.equal(pulled.baseLock, undefined);
});

test("from a sync point, a binding you removed stays removed and your newer snapshot stays, while a teammate's changes still arrive", () => {
  const base = lock({
    paywalls: {
      removed: { ios: { paywallId: "1", snapshot: "r" } },
      "removed-then-changed": { ios: { paywallId: "2", snapshot: "old" } },
      newer: { ios: { paywallId: "3", snapshot: "v1" } },
      teammate: { ios: { paywallId: "4", snapshot: "v1" } },
      "both-changed": { ios: { paywallId: "5", snapshot: "v1" } },
      "removed-by-teammate": { ios: { paywallId: "6", snapshot: "v1" } },
      "removed-there-changed-here": { ios: { paywallId: "7", snapshot: "v1" } },
    },
    funnels: { gone: { ios: { paywallId: "20" } } },
    origins: { "paywall/removed": { paywallId: "1", url: "u1" } },
  });
  const local = lock({
    paywalls: {
      newer: { ios: { paywallId: "3", snapshot: "v2" } },
      teammate: { ios: { paywallId: "4", snapshot: "v1" } },
      "both-changed": { ios: { paywallId: "5", snapshot: "mine" } },
      "removed-by-teammate": { ios: { paywallId: "6", snapshot: "v1" } },
      "removed-there-changed-here": { ios: { paywallId: "7", snapshot: "v2" } },
      pending: { ios: { paywallId: "8", snapshot: "p", sourcePending: 3 } },
    },
  });
  const remote = lock({
    paywalls: {
      removed: { ios: { paywallId: "1", snapshot: "r" } },
      "removed-then-changed": { ios: { paywallId: "2", snapshot: "new" } },
      newer: { ios: { paywallId: "3", snapshot: "v1" } },
      teammate: { ios: { paywallId: "4", snapshot: "v2" } },
      "both-changed": { ios: { paywallId: "5", snapshot: "theirs" } },
      pending: { ios: { paywallId: "8", snapshot: "landed" } },
      added: { ios: { paywallId: "9", snapshot: "a" } },
    },
    funnels: { gone: { ios: { paywallId: "20" } } },
    origins: {
      "paywall/removed": { paywallId: "1", url: "u1" },
      "paywall/added": { paywallId: "9", url: "u9" },
    },
  });

  const merged = mergePulledLock(local, formatLock(remote), undefined, formatLock(base));

  assert.deepEqual(merged.paywalls, {
    newer: { ios: { paywallId: "3", snapshot: "v2" } },
    teammate: { ios: { paywallId: "4", snapshot: "v2" } },
    "both-changed": { ios: { paywallId: "5", snapshot: "theirs" } },
    "removed-there-changed-here": { ios: { paywallId: "7", snapshot: "v2" } },
    pending: { ios: { paywallId: "8", snapshot: "p", sourcePending: 3 } },
    "removed-then-changed": { ios: { paywallId: "2", snapshot: "new" } },
    added: { ios: { paywallId: "9", snapshot: "a" } },
  });
  assert.deepEqual(merged.funnels, {});
  assert.deepEqual(merged.origins, { "paywall/added": { paywallId: "9", url: "u9" } });
});

test("a teammate's rename arrives as the new name alone", () => {
  const base = lock({ paywalls: { old: { ios: { paywallId: "1", snapshot: "s" } } } });
  const remote = lock({ paywalls: { renamed: { ios: { paywallId: "1", snapshot: "s2" } } } });

  const merged = mergePulledLock(base, formatLock(remote), undefined, formatLock(base));

  assert.deepEqual(merged.paywalls, { renamed: { ios: { paywallId: "1", snapshot: "s2" } } });
});

test("a pull never binds one paywall under a second name, with or without a sync point", () => {
  const local = lock({
    paywalls: {
      renamed: { ios: { paywallId: "1", snapshot: "new" } },
      empty: {},
    },
  });
  const remote = formatLock(
    lock({
      apps: { ios: "42", android: "7" },
      paywalls: {
        old: {
          ios: { paywallId: "1", snapshot: "stale" },
          android: { paywallId: "1", snapshot: "a" },
        },
        other: { ios: { paywallId: "2", snapshot: "o" } },
      },
      funnels: { flow: { ios: { paywallId: "1" } } },
    }),
  );
  const expected = {
    renamed: { ios: { paywallId: "1", snapshot: "new" } },
    empty: {},
    old: { android: { paywallId: "1", snapshot: "a" } },
    other: { ios: { paywallId: "2", snapshot: "o" } },
  };

  const unsynced = mergePulledLock(local, remote);
  assert.deepEqual(unsynced.paywalls, expected);
  assert.deepEqual(unsynced.funnels, { flow: { ios: { paywallId: "1" } } });

  const synced = mergePulledLock(local, remote, undefined, formatLock(lock()));
  assert.deepEqual(synced.paywalls, expected);
});

test("a lock at the sync point that can't be read, or of a platform the pull left out, never removes a binding", () => {
  const local = lock({
    apps: { ios: "42", android: "7" },
    paywalls: { a: { ios: { paywallId: "1", snapshot: "s" }, android: { paywallId: "2" } } },
  });
  const remote = formatLock(
    lock({
      apps: { ios: "42", android: "7" },
      paywalls: {
        a: { ios: { paywallId: "1", snapshot: "s" }, android: { paywallId: "2" } },
        b: { ios: { paywallId: "3" } },
      },
    }),
  );

  const unreadable = mergePulledLock(local, remote, undefined, "{ not json");
  assert.deepEqual(unreadable.paywalls, {
    a: { ios: { paywallId: "1", snapshot: "s" }, android: { paywallId: "2" } },
    b: { ios: { paywallId: "3" } },
  });

  const scoped = mergePulledLock(local, remote, ["ios"], remote);
  assert.deepEqual(scoped.paywalls, {
    a: { ios: { paywallId: "1", snapshot: "s" }, android: { paywallId: "2" } },
  });
});

test("--platform pulls every binding of the app it names, so the next push never removes one it skipped", () => {
  const repo = lock({
    apps: { ios: "42", web: "42" },
    paywalls: {
      a: { ios: { paywallId: "1", snapshot: "s" } },
      x: { web: { paywallId: "2", snapshot: "s" } },
    },
  });
  const local = lock({
    apps: { ios: "42", web: "42" },
    paywalls: { a: { ios: { paywallId: "1", snapshot: "s" } } },
  });

  const pulled = mergePulledLock(local, formatLock(repo), ["ios"]);
  assert.deepEqual(pulled.paywalls.x, { web: { paywallId: "2", snapshot: "s" } });

  const committed = JSON.parse(
    mergeLockText(
      formatLock(repo),
      formatLock({
        ...pulled,
        paywalls: { ...pulled.paywalls, a: { ios: { paywallId: "1", snapshot: "t" } } },
      }),
      { kind: "paywall", id: "a" },
      { base: formatLock(repo), application: "42" },
    ),
  );
  assert.deepEqual(committed.paywalls.x, { web: { paywallId: "2", snapshot: "s" } });
});

test("pushes then pulls leave superwall.lock as pushed: a renamed binding stays renamed and no snapshot goes back", async () => {
  const repo = bareRepo();
  const source = access(repo.remote);
  const dir = temp("superwall-pull-project-");
  writeLock(dir, lock({ apps: { ios: "15790" } }));
  fs.writeFileSync(path.join(dir, "package.json"), '{ "name": "project" }\n');
  const surface = (id: string, body: string) => {
    fs.mkdirSync(path.join(dir, "paywalls", id), { recursive: true });
    fs.writeFileSync(path.join(dir, "paywalls", id, "index.tsx"), body);
  };
  let version = 0;
  const push = async (id: string, paywallId: string, snapshot: string) => {
    const collected = await collectSourceFiles(dir);
    assert.ok(collected.ok);
    if (!readLock(dir).paywalls[id]?.ios) writeBinding(dir, "paywall", id, "ios", { paywallId });
    writeSnapshot(dir, "paywall", id, "ios", { snapshot, sourcePending: ++version });
    const pushed = await pushSourceTree({
      access: source,
      base: readSourceBase(dir, source.repo),
      files: withCurrentLock(dir, collected.files, { kind: "paywall", id, paywallId }),
      message: {
        kind: "paywall",
        surface: id,
        version,
        paywallId,
        applicationId: "15790",
        framework: "0.4.2",
      },
    });
    if (pushed.syncedTo) writeSourceBase(dir, source.repo, pushed.syncedTo);
    writeSnapshot(dir, "paywall", id, "ios", { snapshot });
  };
  const remoteLock = () =>
    parseLock(
      execFileSync("git", ["--git-dir", repo.dir, "show", "main:superwall.lock"], {
        encoding: "utf8",
      }),
      "remote",
    ).paywalls;
  const localLock = () => readLock(dir).paywalls;

  surface("onboarding", "onboarding v1\n");
  await push("onboarding", "290451", "3be7760");

  fs.renameSync(
    path.join(dir, "paywalls", "onboarding"),
    path.join(dir, "paywalls", "fivepointfive-onboarding"),
  );
  const renamed = readLock(dir);
  renamed.paywalls = { "fivepointfive-onboarding": renamed.paywalls.onboarding ?? {} };
  writeLock(dir, renamed);
  surface("astari-paywall", "astari v1\n");
  await push("astari-paywall", "291235", "78793b3");
  const oldName = { onboarding: { ios: { paywallId: "290451", snapshot: "3be7760" } } };
  assert.deepEqual(remoteLock(), {
    ...oldName,
    "astari-paywall": { ios: { paywallId: "291235", snapshot: "78793b3" } },
  });

  surface("astari-paywall", "astari v2\n");
  await push("astari-paywall", "291235", "1672c40");
  const afterSecondPush = {
    "fivepointfive-onboarding": { ios: { paywallId: "290451", snapshot: "3be7760" } },
    "astari-paywall": { ios: { paywallId: "291235", snapshot: "1672c40" } },
  };
  assert.deepEqual(remoteLock(), {
    ...oldName,
    "astari-paywall": afterSecondPush["astari-paywall"],
  });

  assert.deepEqual((await pullInto(dir, source, false))?.written, []);
  assert.deepEqual(localLock(), afterSecondPush);

  surface("fivepointfive-onboarding", "onboarding v4\n");
  await push("fivepointfive-onboarding", "290451", "db1ab33");
  const afterFourthPush = {
    "fivepointfive-onboarding": { ios: { paywallId: "290451", snapshot: "db1ab33" } },
    "astari-paywall": { ios: { paywallId: "291235", snapshot: "1672c40" } },
  };
  assert.deepEqual(remoteLock(), afterFourthPush);

  await pullInto(dir, source, false);
  assert.deepEqual(localLock(), afterFourthPush);
});

test("a stale old name already in the source repo stays out of the project, with or without a sync point", async () => {
  const repo = bareRepo();
  const source = access(repo.remote);
  const stale = lock({
    apps: { ios: "15790" },
    paywalls: {
      onboarding: { ios: { paywallId: "290451", snapshot: "3be7760" } },
      "astari-paywall": { ios: { paywallId: "291235", snapshot: "78793b3" } },
    },
  });
  const base = commit(repo, {
    "superwall.lock": formatLock(stale),
    "package.json": '{ "name": "project" }\n',
  });
  const dir = temp("superwall-pull-project-");
  fs.writeFileSync(path.join(dir, "package.json"), '{ "name": "project" }\n');
  const mine = {
    "fivepointfive-onboarding": { ios: { paywallId: "290451", snapshot: "db1ab33" } },
    "astari-paywall": { ios: { paywallId: "291235", snapshot: "1672c40" } },
  };

  writeLock(
    dir,
    lock({ apps: { ios: "15790" }, paywalls: mine, sources: { [source.repo]: base } }),
  );
  await pullInto(dir, source, false);
  assert.deepEqual(readLock(dir).paywalls, mine);

  writeLock(dir, lock({ apps: { ios: "15790" }, paywalls: mine }));
  await pullInto(dir, source, false);
  assert.deepEqual(readLock(dir).paywalls, {
    "fivepointfive-onboarding": mine["fivepointfive-onboarding"],
    "astari-paywall": { ios: { paywallId: "291235", snapshot: "78793b3" } },
  });
});

test("a teammate's rebinding to a paywall you bound under another name keeps your binding", () => {
  const base = lock({ paywalls: { a: { ios: { paywallId: "1", snapshot: "s" } } } });
  const local = lock({
    paywalls: {
      a: { ios: { paywallId: "1", snapshot: "s" } },
      b: { ios: { paywallId: "2", snapshot: "b" } },
    },
  });
  const remote = lock({ paywalls: { a: { ios: { paywallId: "2", snapshot: "t" } } } });

  const merged = mergePulledLock(local, formatLock(remote), undefined, formatLock(base));

  assert.deepEqual(merged.paywalls, {
    a: { ios: { paywallId: "1", snapshot: "s" } },
    b: { ios: { paywallId: "2", snapshot: "b" } },
  });
});
