import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { downloadRepoDir, RepoDownloadError } from "@/core/repo/download";
import { repoTarball, respondWith, scratch } from "../artifacts/fixture";

const tempTars = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("superwall-example-") || name.startsWith("superwall-download-"));

test("it extracts only the directory asked for, at any depth", async () => {
  const target = scratch();
  await downloadRepoDir("a/b/c", target, "nope", respondWith(200, repoTarball({ "a/b/c/d/file": "x", "a/other": "y" })) as never);
  assert.equal(fs.readFileSync(path.join(target, "d", "file"), "utf8"), "x");
  assert.equal(fs.existsSync(path.join(target, "other")), false);
});

test("a network failure or a timeout reads as one, with the signal passed down", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(
    downloadRepoDir("a", scratch(), "nope", async (_url, init) => {
      signal = init?.signal;
      throw new TypeError("fetch failed");
    }),
    (error: Error) => {
      assert.ok(error instanceof RepoDownloadError);
      assert.match(error.message, /Could not reach github\.com.*Check your network/);
      return true;
    },
  );
  assert.ok(signal instanceof AbortSignal);
  await assert.rejects(
    downloadRepoDir("a", scratch(), "nope", async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        throw new DOMException("aborted", "TimeoutError");
      },
      json: async () => ({}),
    })),
    /Could not reach/,
  );
});

test("its temp files are private to the run and don't outlive it", async () => {
  const before = new Set(tempTars());
  await downloadRepoDir("a", scratch(), "nope", respondWith(200, repoTarball({ "a/file": "x" })) as never);
  await assert.rejects(downloadRepoDir("missing", scratch(), "not there", respondWith(200, repoTarball({ "a/file": "x" })) as never), /not there/);
  assert.deepEqual(tempTars().filter((name) => !before.has(name)), []);
});

test("a predictable tar in the temp directory can't be reused", async () => {
  const planted = path.join(os.tmpdir(), `superwall-example-${process.pid}.tar`);
  fs.writeFileSync(planted, "planted");
  try {
    const target = scratch();
    await downloadRepoDir("a", target, "nope", respondWith(200, repoTarball({ "a/file": "real" })) as never);
    assert.equal(fs.readFileSync(path.join(target, "file"), "utf8"), "real");
    assert.equal(fs.readFileSync(planted, "utf8"), "planted");
  } finally {
    fs.rmSync(planted, { force: true });
  }
});
