import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  describeBindings,
  readLock,
  removeBinding,
  writeApp,
  writeBinding,
  writeBindings,
  writeSnapshot,
} from "@/core/paywalls/project/lock";

const dirs: string[] = [];

function scaffold(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-lock-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const EMPTY = { version: 1, apps: {}, paywalls: {}, funnels: {} };

test("readLock returns an empty lock when the file is missing", () => {
  assert.deepEqual(readLock(scaffold()), EMPTY);
});

test("apps and per-app bindings round-trip and merge", () => {
  const dir = scaffold();
  writeApp(dir, "ios", "7");
  writeApp(dir, "android", "8");
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  writeBinding(dir, "paywall", "plus-upgrade", "android", { paywallId: "208541" });
  writeBinding(dir, "funnel", "onboarding", "ios", { paywallId: "300001" });

  const lock = readLock(dir);
  assert.deepEqual(lock.apps, { ios: "7", android: "8" });
  assert.deepEqual(lock.paywalls["plus-upgrade"], {
    ios: { paywallId: "208540" },
    android: { paywallId: "208541" },
  });
  assert.deepEqual(lock.funnels.onboarding, { ios: { paywallId: "300001" } });

  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "999999" });
  const rewritten = readLock(dir);
  assert.deepEqual(rewritten.paywalls["plus-upgrade"], {
    ios: { paywallId: "999999" },
    android: { paywallId: "208541" },
  });
  assert.deepEqual(rewritten.apps, { ios: "7", android: "8" });
});

test("the file is written with the explainer first and apps before bindings", () => {
  const dir = scaffold();
  writeApp(dir, "ios", "7");
  const raw = fs.readFileSync(path.join(dir, "superwall.lock"), "utf8");
  assert.deepEqual(Object.keys(JSON.parse(raw)), ["//", "version", "apps", "paywalls", "funnels"]);
  assert.match(raw, /per app/);
  assert.equal(JSON.parse(raw).version, 1);
});

test("snapshots are stamped per app and only rewrite when they change", () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "1" });
  writeBinding(dir, "paywall", "plus-upgrade", "android", { paywallId: "2" });
  const file = path.join(dir, "superwall.lock");

  writeSnapshot(dir, "paywall", "plus-upgrade", "ios", "abc");
  assert.deepEqual(readLock(dir).paywalls["plus-upgrade"], {
    ios: { paywallId: "1", snapshot: "abc" },
    android: { paywallId: "2" },
  });

  const before = fs.statSync(file).mtimeMs;
  fs.utimesSync(file, new Date(0), new Date(0));
  writeSnapshot(dir, "paywall", "plus-upgrade", "ios", "abc");
  writeSnapshot(dir, "paywall", "plus-upgrade", "web", "abc");
  writeSnapshot(dir, "paywall", "missing", "ios", "abc");
  assert.equal(fs.statSync(file).mtimeMs, 0, "an unchanged snapshot never rewrites the file");
  assert.ok(before >= 0);
});

test("writeBindings replaces a surface's whole map and removeBinding drops it for every app", () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "1" });
  writeBindings(dir, "paywall", "pro-upgrade", { ios: { paywallId: "1" }, android: { paywallId: "2" } });
  assert.equal(removeBinding(dir, "paywall", "plus-upgrade"), true);
  assert.equal(removeBinding(dir, "paywall", "plus-upgrade"), false);
  assert.deepEqual(readLock(dir).paywalls, {
    "pro-upgrade": { ios: { paywallId: "1" }, android: { paywallId: "2" } },
  });
});

test("corrupt, malformed, or future-version lock files read as unbound", () => {
  const dir = scaffold();
  fs.writeFileSync(path.join(dir, "superwall.lock"), "not json {");
  assert.deepEqual(readLock(dir), EMPTY);

  fs.writeFileSync(path.join(dir, "superwall.lock"), JSON.stringify({ version: 2 }));
  assert.deepEqual(readLock(dir), EMPTY);

  fs.writeFileSync(
    path.join(dir, "superwall.lock"),
    JSON.stringify({ version: 1, applicationId: "7", paywalls: { a: { paywallId: "1" } } }),
  );
  assert.deepEqual(readLock(dir), EMPTY, "the pre-apps shape is not read — nothing shipped it");

  fs.writeFileSync(path.join(dir, "superwall.lock"), "[]");
  assert.deepEqual(readLock(dir), EMPTY);

  fs.writeFileSync(
    path.join(dir, "superwall.lock"),
    JSON.stringify({
      version: 1,
      apps: { ios: "7", bad: 1 },
      paywalls: { a: { ios: { paywallId: 1 } }, b: "x", c: { ios: { paywallId: "2", snapshot: 3 } } },
      funnels: 4,
    }),
  );
  assert.deepEqual(readLock(dir), {
    version: 1,
    apps: { ios: "7" },
    paywalls: { c: { ios: { paywallId: "2" } } },
    funnels: {},
  });
});

test("describeBindings names one paywall plainly and several by app", () => {
  assert.equal(describeBindings({ ios: { paywallId: "1" } }), "paywall 1");
  assert.equal(
    describeBindings({ ios: { paywallId: "1" }, android: { paywallId: "2" } }),
    "paywalls 1 (ios), 2 (android)",
  );
});
