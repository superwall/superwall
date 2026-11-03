import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLock, NewerLockError, type LockFile } from "@/core/paywalls/project/lock";
import {
  classifyPath,
  isOtherSurfaceDir,
  isSurfaceRoot,
  mergeLockText,
  SourceLockUnreadableError,
  surfaceOf,
} from "@/core/paywalls/source/scope";

const scope = { kind: "paywall" as const, id: "a" };

const lock = (over: Partial<LockFile> = {}): LockFile => ({
  version: 1,
  apps: { ios: "42" },
  paywalls: {},
  funnels: {},
  ...over,
});

const merged = (theirs: string | undefined, mine: LockFile) => JSON.parse(mergeLockText(theirs, formatLock(mine), scope));

test("paths split into the pushed surface, other surfaces, shared files and derived files", () => {
  assert.equal(classifyPath("paywalls/a/app/index.tsx", scope), "own");
  assert.equal(classifyPath("paywalls/a/config.ts", scope), "own");
  assert.equal(classifyPath("paywalls/b/app/index.tsx", scope), "other");
  assert.equal(classifyPath("funnels/a/config.ts", scope), "other");
  assert.equal(classifyPath("components/button.tsx", scope), "shared");
  assert.equal(classifyPath("package.json", scope), "shared");
  assert.equal(classifyPath("paywalls/readme.md", scope), "shared");
  assert.equal(classifyPath("superwall.lock", scope), "derived");
  assert.equal(classifyPath("superwall.d.ts", scope), "derived");
  assert.equal(classifyPath("paywalls/a/superwall.lock", scope), "own");
});

test("a surface is named only by a file inside its directory", () => {
  assert.deepEqual(surfaceOf("funnels/onboarding/app/index.tsx"), { kind: "funnel", id: "onboarding" });
  assert.equal(surfaceOf("paywalls/a"), undefined);
  assert.equal(surfaceOf("assets/paywalls/a/x.png"), undefined);
});

test("only another surface's directory is kept when the tree is rebuilt", () => {
  assert.equal(isOtherSurfaceDir("paywalls", "b", scope), true);
  assert.equal(isOtherSurfaceDir("funnels", "a", scope), true);
  assert.equal(isOtherSurfaceDir("paywalls", "a", scope), false);
  assert.equal(isOtherSurfaceDir("components", "b", scope), false);
});

test("the merged lock keeps other surfaces from theirs and takes the pushed one from mine", () => {
  const theirs = formatLock(
    lock({
      apps: { ios: "42", android: "43" },
      paywalls: {
        a: { ios: { paywallId: "1", snapshot: "theirs" } },
        b: { ios: { paywallId: "2", snapshot: "theirs-b" } },
      },
      funnels: { f: { web: { paywallId: "3" } } },
      origins: {
        "paywall/a": { paywallId: "1", url: "theirs" },
        "paywall/b": { paywallId: "2", url: "b" },
      },
    }),
  );

  const result = merged(
    theirs,
    lock({
      apps: { ios: "99" },
      paywalls: {
        a: { ios: { paywallId: "1", snapshot: "mine", sourcePending: 4 } },
        b: { ios: { paywallId: "2", snapshot: "stale-b" } },
      },
      origins: { "paywall/a": { paywallId: "1", url: "mine" } },
      sources: { "org1-app42": "f".repeat(40) },
    }),
  );

  assert.deepEqual(result.apps, { ios: "99", android: "43" });
  assert.deepEqual(result.paywalls.a, { ios: { paywallId: "1", snapshot: "mine", sourcePending: 4 } });
  assert.deepEqual(result.paywalls.b, { ios: { paywallId: "2", snapshot: "theirs-b" } });
  assert.deepEqual(result.funnels, { f: { web: { paywallId: "3" } } });
  assert.deepEqual(result.origins, {
    "paywall/a": { paywallId: "1", url: "mine" },
    "paywall/b": { paywallId: "2", url: "b" },
  });
  assert.equal(result.sources, undefined);
});

test("a pushed surface the pusher has no entry or origin for is dropped from the merged lock", () => {
  const theirs = formatLock(
    lock({
      paywalls: { a: { ios: { paywallId: "1" } }, b: { ios: { paywallId: "2" } } },
      origins: { "paywall/a": { paywallId: "1", url: "x" } },
    }),
  );

  const result = merged(theirs, lock());

  assert.deepEqual(Object.keys(result.paywalls), ["b"]);
  assert.equal(result.origins, undefined);
});

test("with no lock in the repo the merged lock is mine", () => {
  const mine = lock({ paywalls: { a: { ios: { paywallId: "1" } } }, sources: { repo: "a".repeat(40) } });
  const expected = formatLock({ version: 1, apps: mine.apps, paywalls: mine.paywalls, funnels: {} });

  assert.equal(mergeLockText(undefined, formatLock(mine), scope), expected);
});

test("an unreadable lock in the repo is refused, never read as having no bindings", () => {
  const mine = lock({ paywalls: { a: { ios: { paywallId: "1" } } }, sources: { repo: "a".repeat(40) } });
  const expected = formatLock({ version: 1, apps: mine.apps, paywalls: mine.paywalls, funnels: {} });

  for (const theirs of ['{"version":1,"apps":{"ios":"42"},"paywalls":{"b"', "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n"]) {
    assert.throws(() => mergeLockText(theirs, formatLock(mine), scope), SourceLockUnreadableError);
    assert.equal(mergeLockText(theirs, formatLock(mine), scope, { replaceUnreadable: true }), expected);
  }
});

test("a lock from a newer CLI in the repo stops the merge rather than being downgraded", () => {
  const newer = JSON.stringify({ version: 2, apps: {}, paywalls: {}, funnels: {} });

  assert.throws(() => mergeLockText(newer, formatLock(lock()), scope), NewerLockError);
});

test("a lock of mine that can't be read is passed through untouched", () => {
  assert.equal(mergeLockText(formatLock(lock()), "broken", scope), "broken");
});

test("only paywalls and funnels are surface roots", () => {
  assert.equal(isSurfaceRoot("paywalls"), true);
  assert.equal(isSurfaceRoot("funnels"), true);
  assert.equal(isSurfaceRoot("components"), false);
});
