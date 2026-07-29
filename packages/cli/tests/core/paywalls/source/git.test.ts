import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { gitAvailable, gitReason, materializeSourceTree, pushSourceTree } from "@/core/paywalls/source/git";
import type { SourceFile } from "@/core/paywalls/source/source";

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
    files: [file("config.ts", "export default {};\n"), file("paywalls/a/app/page.tsx", "x\n")],
    message,
  });

  assert.equal(result.status, "committed");
  assert.match(result.commitSha, /^[a-f0-9]{40}$/);
  assert.deepEqual(treeFiles(repo.dir), ["config.ts", "paywalls/a/app/page.tsx"]);
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
  await pushSourceTree({
    access: access(repo.remote),
    files: [file("keep.ts", "a\n"), file("gone.ts", "b\n")],
    message,
  });

  await pushSourceTree({
    access: access(repo.remote),
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
  materializeSourceTree(dir, files);

  fs.writeFileSync(path.join(dir, "stale.ts"), "remove me");
  materializeSourceTree(dir, files);

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
