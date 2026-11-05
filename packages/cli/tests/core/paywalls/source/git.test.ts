import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  gitAvailable,
  gitReason,
  materializeSourceTree,
  pushSourceTree,
  SourceConflictError,
  SourceDivergedError,
} from "@/core/paywalls/source/git";
import type { SourceFile } from "@/core/paywalls/source/source";
import { SourceLockUnreadableError } from "@/core/paywalls/source/scope";
import { formatLock, type SurfaceBindings } from "@/core/paywalls/project/lock";

const dirs: string[] = [];

const temp = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

function bareRepo(branch = "main"): { remote: string; dir: string } {
  const dir = temp("superwall-bare-");
  execFileSync("git", ["init", "--bare", "--initial-branch", branch, dir]);
  return { remote: `file://${dir}`, dir };
}

const access = (remote: string, branch = "main") => ({
  repo: "org1-app42",
  remote,
  branch,
  token: "art_v1_deadbeefcafebabe?expires=1790000000",
  tokenId: "tok_1",
});

const file = (relative: string, content: string | Buffer): SourceFile => ({
  path: relative,
  content: typeof content === "string" ? Buffer.from(content) : content,
});

const message = {
  kind: "paywall" as const,
  surface: "plus-upgrade",
  version: 7,
  paywallId: "208540",
  applicationId: "42",
  framework: "0.4.2",
};

const show = (repo: string, ref: string): string =>
  execFileSync("git", ["--git-dir", repo, "show", ref], { encoding: "utf8" });

const treeFiles = (repo: string, branch = "main"): string[] =>
  execFileSync("git", ["--git-dir", repo, "ls-tree", "-r", "--name-only", branch], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .sort();

const scopeA = { kind: "paywall" as const, id: "a" };

const messageFor = (surface: string, version = 7) => ({ ...message, surface, version });

const bound = (paywallId: string): SurfaceBindings => ({ ios: { paywallId, snapshot: `snap-${paywallId}` } });

const lockWith = (paywalls: Record<string, SurfaceBindings>) =>
  file("superwall.lock", formatLock({ version: 1, apps: { ios: "42" }, paywalls, funnels: {} }));

const blob = (repo: string, relative: string, branch = "main"): string =>
  execFileSync("git", ["--git-dir", repo, "show", `${branch}:${relative}`], { encoding: "utf8" });

const headOf = (repo: string, branch = "main"): string =>
  execFileSync("git", ["--git-dir", repo, "rev-parse", branch], { encoding: "utf8" }).trim();

function seed(repo: { remote: string }, files: readonly SourceFile[]): string {
  const work = temp("superwall-seed-");
  execFileSync("git", ["clone", "--quiet", repo.remote, work], { stdio: "ignore" });
  for (const entry of files) {
    fs.mkdirSync(path.dirname(path.join(work, entry.path)), { recursive: true });
    fs.writeFileSync(path.join(work, entry.path), entry.content);
  }
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", work, "-c", "user.name=Teammate", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
      encoding: "utf8",
    });
  git("add", "-A");
  git("commit", "--quiet", "-m", "teammate");
  git("push", "--quiet", "origin", "HEAD:main");
  return git("rev-parse", "HEAD").trim();
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("git is available in this environment", async () => {
  assert.equal(await gitAvailable(), true);
});

test("pushes a fresh tree into an empty repo and reports it committed", async () => {
  const repo = bareRepo();

  const result = await pushSourceTree({
    access: access(repo.remote),
    files: [file("config.ts", "export default {};\n"), file("paywalls/a/app/index.tsx", "x\n")],
    message: messageFor("a"),
  });

  assert.equal(result.status, "committed");
  assert.match(result.commitSha, /^[a-f0-9]{40}$/);
  assert.deepEqual(treeFiles(repo.dir), ["config.ts", "paywalls/a/app/index.tsx"]);
});

test("the commit carries the platform's message and the Superwall identity", async () => {
  const repo = bareRepo();

  await pushSourceTree({
    access: access(repo.remote),
    files: [file("config.ts", "x\n")],
    message: { ...message, snapshotSha: "a".repeat(64), cli: "1.0.0", note: "Ship it" },
  });

  const shown = show(repo.dir, "main");
  assert.match(shown, /Author: Superwall <publish@superwall\.com>/);
  assert.match(shown, /publish paywall\/plus-upgrade v7/);
  assert.match(shown, /\n {4}Ship it\n/);
  assert.match(shown, /Superwall-Snapshot: a{64}/);
  assert.match(shown, /Superwall-Cli: 1\.0\.0/);
});

test("an identical tree pushed again is unchanged, at the same sha", async () => {
  const repo = bareRepo();
  const files = [file("config.ts", "export default {};\n")];

  const first = await pushSourceTree({
    access: access(repo.remote),
    files,
    message,
  });
  const second = await pushSourceTree({
    access: access(repo.remote),
    files,
    message: { ...message, version: 8 },
  });

  assert.equal(first.status, "committed");
  assert.equal(second.status, "unchanged");
  assert.equal(second.commitSha, first.commitSha);
});

test("a changed file makes a new commit on top of the old one", async () => {
  const repo = bareRepo();

  const first = await pushSourceTree({
    access: access(repo.remote),
    files: [file("config.ts", "one\n")],
    message,
  });
  const second = await pushSourceTree({
    access: access(repo.remote),
    base: first.syncedTo,
    files: [file("config.ts", "two\n")],
    message: { ...message, version: 8 },
  });

  assert.equal(second.status, "committed");
  assert.notEqual(second.commitSha, first.commitSha);
  const log = execFileSync("git", ["--git-dir", repo.dir, "log", "--oneline"], {
    encoding: "utf8",
  });
  assert.equal(log.trim().split("\n").length, 2);
});

test("deleting a source file removes it from the repo", async () => {
  const repo = bareRepo();
  const first = await pushSourceTree({
    access: access(repo.remote),
    files: [file("keep.ts", "a\n"), file("gone.ts", "b\n")],
    message,
  });

  await pushSourceTree({
    access: access(repo.remote),
    base: first.syncedTo,
    files: [file("keep.ts", "a\n")],
    message: { ...message, version: 8 },
  });

  assert.deepEqual(treeFiles(repo.dir), ["keep.ts"]);
});

test("a large binary is committed verbatim, not summarized", async () => {
  const repo = bareRepo();
  const bytes = Buffer.alloc(300 * 1024, 7);

  await pushSourceTree({
    access: access(repo.remote),
    files: [file("assets/hero.mp4", bytes)],
    message,
  });

  assert.deepEqual(treeFiles(repo.dir), ["assets/hero.mp4"]);
  const committed = execFileSync(
    "git",
    ["--git-dir", repo.dir, "cat-file", "blob", "main:assets/hero.mp4"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(committed.byteLength, bytes.byteLength);
  assert.deepEqual(createHash("sha256").update(committed).digest("hex"), createHash("sha256").update(bytes).digest("hex"));
});

test("the tree is exactly the collected files — nothing generated joins them", async () => {
  const repo = bareRepo();

  await pushSourceTree({
    access: access(repo.remote),
    files: [file("a.ts", "1\n"), file("nested/b.png", Buffer.from([1, 2, 3]))],
    message,
  });

  assert.deepEqual(treeFiles(repo.dir), ["a.ts", "nested/b.png"]);
});

test("an unreachable remote fails without ever echoing the token", async () => {
  const missing = path.join(temp("superwall-missing-"), "nope.git");

  const error = await pushSourceTree({
    access: access(`file://${missing}`),
    files: [file("config.ts", "x\n")],
    message,
  }).then(
    () => undefined,
    (thrown: unknown) => (thrown instanceof Error ? thrown.message : String(thrown)),
  );

  assert.ok(error);
  assert.ok(!error.includes("deadbeefcafebabe"), `token leaked into: ${error}`);
  assert.ok(!error.includes("art_v1_"), `token leaked into: ${error}`);
  assert.ok(!error.includes("Command failed:"), `command dump leaked into: ${error}`);
  assert.equal(error.split("\n").length, 1, `expected one line, got: ${error}`);
  assert.match(error, /^git clone failed: /);
});

test("git's own reason survives; the command dump and the fatal prefix do not", () => {
  assert.equal(
    gitReason("Cloning into '/tmp/x'...\nfatal: repository 'file:///nope' does not exist\n"),
    "repository 'file:///nope' does not exist",
  );
  assert.equal(
    gitReason("Command failed: git push origin HEAD:main\nerror: failed to push some refs\n"),
    "failed to push some refs",
  );
});

test("a reasonless failure still says something rather than nothing", () => {
  assert.equal(gitReason(""), "git reported no reason.");
  assert.equal(gitReason("Command failed: git clone x"), "git reported no reason.");
  assert.equal(gitReason("something odd happened"), "something odd happened");
});

test("materializing twice from the same files is byte-stable", () => {
  const dir = temp("superwall-tree-");
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "keep"), "sentinel");

  const files = [file("a.ts", "1\n"), file("nested/b.ts", "2\n")];
  materializeSourceTree(dir, files, scopeA);

  fs.writeFileSync(path.join(dir, "stale.ts"), "remove me");
  materializeSourceTree(dir, files, scopeA);

  assert.equal(fs.existsSync(path.join(dir, "stale.ts")), false);
  assert.equal(fs.readFileSync(path.join(dir, ".git", "keep"), "utf8"), "sentinel");
  assert.deepEqual(fs.readdirSync(dir).sort(), [".git", "a.ts", "nested"]);
});

test("gitAvailable reports false when no git binary is on PATH", async () => {
  const savedPath = process.env.PATH;
  process.env.PATH = temp("superwall-empty-path-");
  try {
    assert.equal(await gitAvailable(), false);
  } finally {
    process.env.PATH = savedPath;
  }
});

test("with no sync point, a remote that already differs is refused, naming the files, and nothing lands", async () => {
  const repo = bareRepo();
  const theirs = await pushSourceTree({
    access: access(repo.remote),
    files: [file("config.ts", "theirs\n"), ...Array.from({ length: 6 }, (_, i) => file(`f${i}.ts`, "x\n"))],
    message,
  });

  const error = await pushSourceTree({
    access: access(repo.remote),
    files: [file("config.ts", "mine\n"), ...Array.from({ length: 6 }, (_, i) => file(`f${i}.ts`, "y\n"))],
    message: { ...message, version: 8 },
  }).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof SourceDivergedError);
  assert.deepEqual([...error.files].sort(), ["config.ts", "f0.ts", "f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts"]);
  assert.match(error.message, /config\.ts, f0\.ts, f1\.ts, f2\.ts, f3\.ts and 2 more/);
  assert.match(error.message, /--overwrite-source/);
  assert.equal(execFileSync("git", ["--git-dir", repo.dir, "rev-parse", "main"], { encoding: "utf8" }).trim(), theirs.commitSha);
});

test("with no sync point, a remote that already matches is adopted as the base", async () => {
  const repo = bareRepo();
  const files = [file("config.ts", "same\n")];
  const first = await pushSourceTree({ access: access(repo.remote), files, message });

  const second = await pushSourceTree({ access: access(repo.remote), files, message: { ...message, version: 8 } });

  assert.equal(second.status, "unchanged");
  assert.equal(second.syncedTo, first.commitSha);
});

test("a sync point the remote never had is no sync point at all", async () => {
  const repo = bareRepo();
  await pushSourceTree({ access: access(repo.remote), files: [file("config.ts", "theirs\n")], message });

  await assert.rejects(
    pushSourceTree({
      access: access(repo.remote),
      base: "f".repeat(40),
      files: [file("config.ts", "mine\n")],
      message: { ...message, version: 8 },
    }),
    SourceDivergedError,
  );
});

test("overwrite replaces the pushed paywall on top of the remote's history, ignoring the sync point", async () => {
  const repo = bareRepo();
  const theirs = await pushSourceTree({
    access: access(repo.remote),
    files: [file("paywalls/plus-upgrade/old.ts", "t\n"), file("theirs.ts", "t\n")],
    message,
  });

  const result = await pushSourceTree({
    access: access(repo.remote),
    base: "f".repeat(40),
    overwrite: true,
    files: [file("mine.ts", "m\n")],
    message: { ...message, version: 8 },
  });

  assert.equal(result.status, "committed");
  assert.deepEqual(treeFiles(repo.dir), ["mine.ts", "theirs.ts"]);
  const parent = execFileSync("git", ["--git-dir", repo.dir, "rev-parse", "main^1"], { encoding: "utf8" }).trim();
  assert.equal(parent, theirs.commitSha, "history is kept, never force-pushed away");
  assert.equal(result.syncedTo, headOf(repo.dir, "main^2"), "the sync point is this project's own tree");
  assert.deepEqual(treeFiles(repo.dir, result.syncedTo ?? ""), ["mine.ts"]);
});

test("a conflict names what to do with the commands that exist", () => {
  const error = new SourceConflictError(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]);

  assert.match(error.message, /a\.ts, b\.ts, c\.ts, d\.ts, e\.ts and 1 more/);
  assert.match(error.message, /superwall pull/);
  assert.match(error.message, /--overwrite-source/);
});

test("a diverged source points at superwall pull before the overwrite", () => {
  const error = new SourceDivergedError(["paywalls/a/index.tsx"]);

  assert.match(error.message, /paywalls\/a\/index\.tsx/);
  assert.match(error.message, /Run `superwall pull`.*--overwrite-source/);
});

test("the user's git hooks, signing and line-ending settings never touch the source push", async () => {
  const repo = bareRepo();
  const home = temp("superwall-git-home-");
  const hooks = temp("superwall-git-hooks-");
  const marker = path.join(home, "hook-ran");
  fs.writeFileSync(path.join(hooks, "pre-commit"), `#!/bin/sh\ntouch ${marker}\nexit 1\n`, { mode: 0o755 });
  fs.writeFileSync(
    path.join(home, ".gitconfig"),
    `[core]\n  hooksPath = ${hooks}\n  autocrlf = true\n[commit]\n  gpgsign = true\n[gpg]\n  program = false\n`,
  );
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;

  try {
    const result = await pushSourceTree({
      access: access(repo.remote),
      files: [file("config.ts", "one\r\ntwo\n")],
      message,
    });
    assert.equal(result.status, "committed");
  } finally {
    process.env.HOME = saved.HOME;
    if (saved.XDG_CONFIG_HOME !== undefined) process.env.XDG_CONFIG_HOME = saved.XDG_CONFIG_HOME;
  }

  assert.equal(fs.existsSync(marker), false);
  const committed = execFileSync("git", ["--git-dir", repo.dir, "cat-file", "blob", "main:config.ts"], { encoding: "utf8" });
  assert.equal(committed, "one\r\ntwo\n");
});

test("a git repository named by the caller's environment is never the one written to", async () => {
  const repo = bareRepo();
  const decoy = temp("superwall-decoy-");
  execFileSync("git", ["init", "--quiet", decoy]);
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(decoy, ".git");

  try {
    await pushSourceTree({ access: access(repo.remote), files: [file("config.ts", "x\n")], message });
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  }

  assert.deepEqual(treeFiles(repo.dir), ["config.ts"]);
  assert.throws(() => execFileSync("git", ["-C", decoy, "rev-parse", "HEAD"], { stdio: "ignore" }));
});

test("a remote that serves partial clones still checks out, commits and pushes on top", async () => {
  const repo = bareRepo();
  execFileSync("git", ["--git-dir", repo.dir, "config", "uploadpack.allowFilter", "true"]);
  const first = await pushSourceTree({ access: access(repo.remote), files: [file("config.ts", "one\n")], message });

  const second = await pushSourceTree({
    access: access(repo.remote),
    base: first.syncedTo,
    files: [file("config.ts", "two\n")],
    message: { ...message, version: 8 },
  });

  assert.equal(second.status, "committed");
  assert.equal(execFileSync("git", ["--git-dir", repo.dir, "show", "main:config.ts"], { encoding: "utf8" }), "two\n");
});

test("with no sync point, publishing one paywall onto a repo holding a teammate's paywall lands and keeps theirs", async () => {
  const repo = bareRepo();
  const shared = file("package.json", "{}\n");
  seed(repo, [shared, file("paywalls/b/app/index.tsx", "b by a teammate\n"), lockWith({ b: bound("2") })]);

  const result = await pushSourceTree({
    access: access(repo.remote),
    files: [shared, file("paywalls/a/app/index.tsx", "a\n"), lockWith({ a: bound("1") })],
    message: messageFor("a", 8),
  });

  assert.equal(result.status, "committed");
  assert.equal(result.syncedTo, headOf(repo.dir, "main^2"), "the sync point is this project's own tree");
  assert.deepEqual(treeFiles(repo.dir, result.syncedTo ?? ""), ["package.json", "paywalls/a/app/index.tsx", "superwall.lock"]);
  assert.deepEqual(treeFiles(repo.dir), ["package.json", "paywalls/a/app/index.tsx", "paywalls/b/app/index.tsx", "superwall.lock"]);
  assert.equal(blob(repo.dir, "paywalls/b/app/index.tsx"), "b by a teammate\n");
  const lock = JSON.parse(blob(repo.dir, "superwall.lock"));
  assert.deepEqual(Object.keys(lock.paywalls).sort(), ["a", "b"]);
  assert.equal(lock.paywalls.b.ios.paywallId, "2");
});

test("with no sync point, another paywall's file turned folder locally never blocks the push", async () => {
  const repo = bareRepo();
  const shared = file("package.json", "{}\n");
  seed(repo, [shared, file("paywalls/b/theme", "file in the repo\n"), lockWith({ b: bound("2") })]);

  const result = await pushSourceTree({
    access: access(repo.remote),
    files: [
      shared,
      file("paywalls/a/app/index.tsx", "a\n"),
      file("paywalls/b/theme/colors.ts", "folder locally\n"),
      lockWith({ a: bound("1"), b: bound("2") }),
    ],
    message: messageFor("a", 8),
  });

  assert.equal(result.status, "committed");
  assert.equal(blob(repo.dir, "paywalls/b/theme"), "file in the repo\n");
  assert.equal(blob(repo.dir, "paywalls/a/app/index.tsx"), "a\n");
});

test("with no sync point, a different copy of the pushed paywall is refused, naming only its files", async () => {
  const repo = bareRepo();
  const theirs = seed(repo, [
    file("paywalls/a/app/index.tsx", "theirs\n"),
    file("paywalls/a/config.ts", "same\n"),
    file("paywalls/b/app/index.tsx", "b\n"),
    file("superwall.d.ts", "theirs\n"),
    lockWith({ a: bound("1"), b: bound("2") }),
  ]);

  const error = await pushSourceTree({
    access: access(repo.remote),
    files: [
      file("paywalls/a/app/index.tsx", "mine\n"),
      file("paywalls/a/config.ts", "same\n"),
      file("superwall.d.ts", "mine\n"),
      lockWith({ a: { ios: { paywallId: "1", snapshot: "other" } } }),
    ],
    message: messageFor("a", 8),
  }).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof SourceDivergedError);
  assert.deepEqual(error.files, ["paywalls/a/app/index.tsx"]);
  assert.equal(headOf(repo.dir), theirs);
});

test("with no sync point, a shared file that differs is refused, and a file the repo lacks is not", async () => {
  const repo = bareRepo();
  await pushSourceTree({
    access: access(repo.remote),
    files: [file("package.json", "theirs\n"), file("components/button.tsx", "kept\n")],
    message: messageFor("b"),
  });

  await assert.rejects(
    pushSourceTree({
      access: access(repo.remote),
      files: [file("package.json", "mine\n"), file("components/button.tsx", "kept\n"), file("components/new.tsx", "new\n")],
      message: messageFor("a", 8),
    }),
    (error: unknown) => error instanceof SourceDivergedError && error.files.join() === "package.json",
  );
});

test("with no sync point, a teammate's paywall this checkout lacks or has stale is never touched", async () => {
  const repo = bareRepo();
  seed(repo, [file("paywalls/b/app/index.tsx", "b v3\n"), file("funnels/onboarding/config.ts", "f\n")]);

  await pushSourceTree({
    access: access(repo.remote),
    files: [file("paywalls/a/app/index.tsx", "a\n"), file("paywalls/b/app/index.tsx", "b v1\n")],
    message: messageFor("a", 8),
  });

  assert.deepEqual(treeFiles(repo.dir), ["funnels/onboarding/config.ts", "paywalls/a/app/index.tsx", "paywalls/b/app/index.tsx"]);
  assert.equal(blob(repo.dir, "paywalls/b/app/index.tsx"), "b v3\n");
});

test("with a sync point, a stale copy of another paywall never reverts a teammate's newer push", async () => {
  const repo = bareRepo();
  const first = await pushSourceTree({
    access: access(repo.remote),
    files: [file("paywalls/a/app/index.tsx", "a1\n"), file("paywalls/b/app/index.tsx", "b1\n")],
    message: messageFor("a"),
  });
  await pushSourceTree({
    access: access(repo.remote),
    base: first.syncedTo,
    files: [file("paywalls/a/app/index.tsx", "a1\n"), file("paywalls/b/app/index.tsx", "b2\n")],
    message: messageFor("b", 8),
  });

  await pushSourceTree({
    access: access(repo.remote),
    base: first.syncedTo,
    files: [file("paywalls/a/app/index.tsx", "a2\n")],
    message: messageFor("a", 9),
  });

  assert.equal(blob(repo.dir, "paywalls/a/app/index.tsx"), "a2\n");
  assert.equal(blob(repo.dir, "paywalls/b/app/index.tsx"), "b2\n");
});

test("overwrite replaces only the pushed paywall and the shared files, keeping every other surface", async () => {
  const repo = bareRepo();
  seed(repo, [
    file("package.json", "theirs\n"),
    file("paywalls/a/app/index.tsx", "theirs a\n"),
    file("paywalls/a/app/extra.tsx", "theirs only\n"),
    file("paywalls/b/app/index.tsx", "b\n"),
    file("funnels/f/config.ts", "f\n"),
    lockWith({ a: bound("1"), b: bound("2") }),
  ]);

  seed(repo, [file("components/teammate.tsx", "theirs\n")]);

  const result = await pushSourceTree({
    access: access(repo.remote),
    overwrite: true,
    files: [file("package.json", "mine\n"), file("paywalls/a/app/index.tsx", "mine a\n"), lockWith({ a: bound("9") })],
    message: messageFor("a", 8),
  });

  assert.equal(result.status, "committed");
  assert.deepEqual(treeFiles(repo.dir), [
    "components/teammate.tsx",
    "funnels/f/config.ts",
    "package.json",
    "paywalls/a/app/index.tsx",
    "paywalls/b/app/index.tsx",
    "superwall.lock",
  ]);
  assert.equal(blob(repo.dir, "package.json"), "mine\n");
  assert.equal(blob(repo.dir, "paywalls/a/app/index.tsx"), "mine a\n");
  const lock = JSON.parse(blob(repo.dir, "superwall.lock"));
  assert.equal(lock.paywalls.a.ios.paywallId, "9");
  assert.equal(lock.paywalls.b.ios.paywallId, "2");
});

test("a merge that conflicts only in the lock and the generated types resolves itself", async () => {
  const repo = bareRepo();
  const first = await pushSourceTree({
    access: access(repo.remote),
    files: [file("superwall.d.ts", "base\n"), lockWith({ a: bound("1"), b: bound("2") })],
    message: messageFor("a"),
  });
  await pushSourceTree({
    access: access(repo.remote),
    base: first.syncedTo,
    files: [
      file("paywalls/a/app/index.tsx", "a\n"),
      file("superwall.d.ts", "alice\n"),
      lockWith({ a: { ios: { paywallId: "1", snapshot: "alice" } }, b: bound("2") }),
    ],
    message: messageFor("a", 8),
  });

  const result = await pushSourceTree({
    access: access(repo.remote),
    base: first.syncedTo,
    files: [
      file("paywalls/b/app/index.tsx", "b\n"),
      file("superwall.d.ts", "bob\n"),
      lockWith({ a: bound("1"), b: { ios: { paywallId: "2", snapshot: "bob" } } }),
    ],
    message: messageFor("b", 9),
  });

  assert.equal(result.status, "committed");
  assert.deepEqual(treeFiles(repo.dir), ["paywalls/a/app/index.tsx", "paywalls/b/app/index.tsx", "superwall.d.ts", "superwall.lock"]);
  assert.equal(blob(repo.dir, "superwall.d.ts"), "bob\n");
  const lock = JSON.parse(blob(repo.dir, "superwall.lock"));
  assert.equal(lock.paywalls.a.ios.snapshot, "alice");
  assert.equal(lock.paywalls.b.ios.snapshot, "bob");
  const parents = execFileSync("git", ["--git-dir", repo.dir, "rev-list", "--parents", "-n", "1", "main"], { encoding: "utf8" })
    .trim()
    .split(" ");
  assert.equal(parents.length, 3, "the result is a merge of both publishes");
});

test("a merge that conflicts in the lock and in a real file is still refused, naming only the real file", async () => {
  const repo = bareRepo();
  const first = await pushSourceTree({
    access: access(repo.remote),
    files: [file("package.json", "base\n"), lockWith({ a: bound("1"), b: bound("2") })],
    message: messageFor("a"),
  });
  const alice = await pushSourceTree({
    access: access(repo.remote),
    base: first.syncedTo,
    files: [file("package.json", "alice\n"), lockWith({ a: { ios: { paywallId: "1", snapshot: "alice" } }, b: bound("2") })],
    message: messageFor("a", 8),
  });

  await assert.rejects(
    pushSourceTree({
      access: access(repo.remote),
      base: first.syncedTo,
      files: [file("package.json", "bob\n"), lockWith({ a: bound("1"), b: { ios: { paywallId: "2", snapshot: "bob" } } })],
      message: messageFor("b", 9),
    }),
    (error: unknown) => error instanceof SourceConflictError && error.files.join() === "package.json",
  );
  assert.equal(headOf(repo.dir), alice.commitSha);
});

test("materializing keeps other surfaces' directories and replaces only the pushed one", () => {
  const dir = temp("superwall-tree-");
  fs.mkdirSync(path.join(dir, ".git"));
  for (const [relative, content] of [
    ["paywalls/a/app/index.tsx", "old a"],
    ["paywalls/a/gone.ts", "gone"],
    ["paywalls/b/app/index.tsx", "b"],
    ["paywalls/stray.ts", "stray"],
    ["funnels/a/config.ts", "funnel a"],
    ["root.ts", "root"],
  ] as const) {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), content);
  }

  materializeSourceTree(dir, [file("paywalls/a/app/index.tsx", "new a"), file("paywalls/b/app/index.tsx", "stale b")], scopeA);

  const read = (relative: string) => fs.readFileSync(path.join(dir, relative), "utf8");
  assert.equal(read("paywalls/a/app/index.tsx"), "new a");
  assert.equal(fs.existsSync(path.join(dir, "paywalls/a/gone.ts")), false);
  assert.equal(read("paywalls/b/app/index.tsx"), "b");
  assert.equal(fs.existsSync(path.join(dir, "paywalls/stray.ts")), false);
  assert.equal(read("funnels/a/config.ts"), "funnel a");
  assert.equal(fs.existsSync(path.join(dir, "root.ts")), false);
});

test("a push without a lock or types file of its own keeps the ones the repo already has", () => {
  const dir = temp("superwall-tree-");
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, "superwall.lock"), "theirs\n");
  fs.writeFileSync(path.join(dir, "superwall.d.ts"), "theirs types\n");

  materializeSourceTree(dir, [file("config.ts", "x")], scopeA);

  assert.equal(fs.readFileSync(path.join(dir, "superwall.lock"), "utf8"), "theirs\n");
  assert.equal(fs.readFileSync(path.join(dir, "superwall.d.ts"), "utf8"), "theirs types\n");
});

test("with no sync point, a shared file this checkout lacks stays in the repo and never refuses", async () => {
  const repo = bareRepo();
  seed(repo, [file("components/teammate.tsx", "theirs\n"), file("paywalls/b/app/index.tsx", "b\n")]);

  const result = await pushSourceTree({
    access: access(repo.remote),
    files: [file("paywalls/a/app/index.tsx", "a\n")],
    message: messageFor("a", 8),
  });

  assert.equal(result.status, "committed");
  assert.deepEqual(treeFiles(repo.dir), ["components/teammate.tsx", "paywalls/a/app/index.tsx", "paywalls/b/app/index.tsx"]);
});

test("materializing on the remote keeps shared files and clears a path whose type changed", () => {
  const dir = temp("superwall-tree-");
  fs.mkdirSync(path.join(dir, ".git"));
  for (const [relative, content] of [
    ["components/teammate.tsx", "theirs"],
    ["paywalls/readme.md", "readme"],
    ["paywalls/a/gone.ts", "gone"],
    ["theme", "a file"],
    ["config", "a file"],
  ] as const) {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), content);
  }
  fs.mkdirSync(path.join(dir, "assets/logo.png"), { recursive: true });

  materializeSourceTree(
    dir,
    [file("paywalls/a/app/index.tsx", "a"), file("theme/colors.ts", "c"), file("assets/logo.png", "png")],
    scopeA,
    { onRemote: true },
  );

  const read = (relative: string) => fs.readFileSync(path.join(dir, relative), "utf8");
  assert.equal(read("components/teammate.tsx"), "theirs");
  assert.equal(read("paywalls/readme.md"), "readme");
  assert.equal(read("config"), "a file");
  assert.equal(fs.existsSync(path.join(dir, "paywalls/a/gone.ts")), false);
  assert.equal(read("theme/colors.ts"), "c");
  assert.equal(read("assets/logo.png"), "png");
});

test("an unreadable lock in the repo refuses the push, and overwrite replaces it with mine", async () => {
  const repo = bareRepo();
  seed(repo, [file("superwall.lock", "{ truncated"), file("paywalls/b/app/index.tsx", "b\n")]);
  const files = [file("paywalls/a/app/index.tsx", "a\n"), lockWith({ a: bound("9") })];

  await assert.rejects(
    pushSourceTree({ access: access(repo.remote), files, message: messageFor("a", 8) }),
    (error: unknown) => error instanceof SourceLockUnreadableError && /--overwrite-source/.test(error.message),
  );
  assert.equal(blob(repo.dir, "superwall.lock"), "{ truncated");

  await pushSourceTree({ access: access(repo.remote), overwrite: true, files, message: messageFor("a", 8) });
  assert.equal(JSON.parse(blob(repo.dir, "superwall.lock")).paywalls.a.ios.paywallId, "9");
  assert.equal(blob(repo.dir, "paywalls/b/app/index.tsx"), "b\n");
});

test("with no sync point, a push that changes nothing still records this project's tree, so the next edit merges", async () => {
  const repo = bareRepo();
  const mine = file("paywalls/a/app/index.tsx", "a\n");
  const remoteHead = seed(repo, [mine, file("paywalls/b/app/index.tsx", "b\n")]);

  const first = await pushSourceTree({ access: access(repo.remote), files: [mine], message: messageFor("a", 8) });
  assert.equal(first.status, "unchanged");
  assert.deepEqual(treeFiles(repo.dir), ["paywalls/a/app/index.tsx", "paywalls/b/app/index.tsx"]);
  assert.equal(headOf(repo.dir, "main^1"), remoteHead);
  assert.equal(first.syncedTo, headOf(repo.dir, "main^2"));

  const second = await pushSourceTree({
    access: access(repo.remote),
    base: first.syncedTo,
    files: [file("paywalls/a/app/index.tsx", "a2\n")],
    message: messageFor("a", 9),
  });
  assert.equal(second.status, "committed");
  assert.equal(blob(repo.dir, "paywalls/a/app/index.tsx"), "a2\n");
  assert.equal(blob(repo.dir, "paywalls/b/app/index.tsx"), "b\n");
});

test("with no sync point, a remote whose whole tree matches this project is adopted as is", async () => {
  const repo = bareRepo();
  const files = [file("paywalls/a/app/index.tsx", "a\n")];
  const remoteHead = seed(repo, files);
  const result = await pushSourceTree({ access: access(repo.remote), files, message: messageFor("a", 8) });
  assert.deepEqual(result, { commitSha: remoteHead, status: "unchanged", syncedTo: remoteHead });
});

test("a project push that can't land names the project's shared files, not a paywall", () => {
  assert.match(new SourceConflictError(["design/tokens.css"], "project").message, /the project's shared files/);
  assert.match(new SourceDivergedError(["design/tokens.css"], "project").message, /the project's shared files/);
});
