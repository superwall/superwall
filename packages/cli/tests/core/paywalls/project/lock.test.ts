import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  describeBindings,
  originKey,
  readLock,
  removeBinding,
  writeApp,
  writeBinding,
  writeBindings,
  writeOrigin,
  writeSnapshot,
  writeSources,
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

test("the paywall a surface was rebuilt from is recorded beside the bindings, never as one", () => {
  const dir = scaffold();
  writeOrigin(dir, "paywall", "increase-your-revenue", {
    paywallId: "65920",
    url: "https://runtime.example/doc/abc",
  });
  writeBinding(dir, "paywall", "increase-your-revenue", "ios", { paywallId: "300100" });

  const lock = readLock(dir);
  assert.deepEqual(lock.origins, {
    [originKey("paywall", "increase-your-revenue")]: {
      paywallId: "65920",
      url: "https://runtime.example/doc/abc",
    },
  });
  assert.deepEqual(lock.paywalls["increase-your-revenue"], { ios: { paywallId: "300100" } });

  fs.writeFileSync(
    path.join(dir, "superwall.lock"),
    JSON.stringify({ version: 1, apps: {}, paywalls: {}, funnels: {}, origins: { odd: { paywallId: 1 } } }),
  );
  assert.equal(readLock(dir).origins, undefined);
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

  writeSnapshot(dir, "paywall", "plus-upgrade", "ios", { snapshot: "abc" });
  assert.deepEqual(readLock(dir).paywalls["plus-upgrade"], {
    ios: { paywallId: "1", snapshot: "abc" },
    android: { paywallId: "2" },
  });

  const before = fs.statSync(file).mtimeMs;
  fs.utimesSync(file, new Date(0), new Date(0));
  writeSnapshot(dir, "paywall", "plus-upgrade", "ios", { snapshot: "abc" });
  writeSnapshot(dir, "paywall", "plus-upgrade", "web", { snapshot: "abc" });
  writeSnapshot(dir, "paywall", "missing", "ios", { snapshot: "abc" });
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

test("a lock that can't be read stops the run instead of reading as unbound", () => {
  const dir = scaffold();
  const file = path.join(dir, "superwall.lock");

  fs.writeFileSync(file, "not json {");
  assert.throws(() => readLock(dir), /isn't valid JSON .* restore it from git/);

  fs.writeFileSync(file, "[]");
  assert.throws(() => readLock(dir), /isn't a Superwall lock file/);

  fs.writeFileSync(file, JSON.stringify({ version: 2 }));
  assert.throws(() => readLock(dir), /newer Superwall CLI \(lock version 2\) — run `superwall upgrade`/);

  fs.writeFileSync(file, JSON.stringify({ version: 0 }));
  assert.throws(() => readLock(dir), /unknown lock version/);

  fs.writeFileSync(
    file,
    ['{', '  "version": 1,', '<<<<<<< HEAD', '  "apps": { "ios": "7" }', '=======', '  "apps": { "ios": "8" }', '>>>>>>> theirs', '}'].join("\n"),
  );
  assert.throws(() => readLock(dir), /unresolved merge conflicts — resolve them/);
});

test("a lock that failed to parse is never written over", () => {
  const dir = scaffold();
  const file = path.join(dir, "superwall.lock");
  fs.writeFileSync(file, "not json {");

  assert.throws(() => writeApp(dir, "ios", "7"));
  assert.throws(() => writeSnapshot(dir, "paywall", "plus-upgrade", "ios", { snapshot: "abc" }));
  assert.equal(fs.readFileSync(file, "utf8"), "not json {");
});

test("a lock is replaced whole, never left half-written beside a temp file", () => {
  const dir = scaffold();
  writeApp(dir, "ios", "7");
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "1" });

  assert.deepEqual(fs.readdirSync(dir), ["superwall.lock"]);
  assert.deepEqual(readLock(dir).apps, { ios: "7" });
});

test("entries the lock can't use are dropped while the rest still reads", () => {
  const dir = scaffold();
  const file = path.join(dir, "superwall.lock");

  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, applicationId: "7", paywalls: { a: { paywallId: "1" } } }),
  );
  assert.deepEqual(readLock(dir), EMPTY, "the pre-apps shape is not read — nothing shipped it");

  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      apps: { ios: "7", bad: 1 },
      paywalls: { a: { ios: { paywallId: 1 } }, b: "x", c: { ios: { paywallId: "2", snapshot: 3 } } },
      funnels: 4,
      sources: { "org1-app7": "nope", "org1-app8": "a".repeat(40) },
    }),
  );
  assert.deepEqual(readLock(dir), {
    version: 1,
    apps: { ios: "7" },
    paywalls: { c: { ios: { paywallId: "2" } } },
    funnels: {},
    sources: { "org1-app8": "a".repeat(40) },
  });
});

test("a version still owed its source is recorded with its snapshot, and cleared once the source lands", () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "1" });

  writeSnapshot(dir, "paywall", "plus-upgrade", "ios", { snapshot: "abc", sourcePending: 7 });
  assert.deepEqual(readLock(dir).paywalls["plus-upgrade"], {
    ios: { paywallId: "1", snapshot: "abc", sourcePending: 7 },
  });

  writeSnapshot(dir, "paywall", "plus-upgrade", "ios", { snapshot: "abc" });
  assert.deepEqual(readLock(dir).paywalls["plus-upgrade"], { ios: { paywallId: "1", snapshot: "abc" } });
});

test("source sync points merge into the lock and are written after the bindings", () => {
  const dir = scaffold();
  writeApp(dir, "ios", "7");
  writeSources(dir, { "org1-app7": "a".repeat(40) });
  writeSources(dir, { "org1-app8": "b".repeat(40) });

  assert.deepEqual(readLock(dir).sources, { "org1-app7": "a".repeat(40), "org1-app8": "b".repeat(40) });
  const raw = fs.readFileSync(path.join(dir, "superwall.lock"), "utf8");
  assert.deepEqual(Object.keys(JSON.parse(raw)), ["//", "version", "apps", "paywalls", "funnels", "sources"]);
});

test("describeBindings names one paywall plainly and several by app", () => {
  assert.equal(describeBindings({ ios: { paywallId: "1" } }), "paywall 1");
  assert.equal(
    describeBindings({ ios: { paywallId: "1" }, android: { paywallId: "2" } }),
    "paywalls 1 (ios), 2 (android)",
  );
});

test("a native screen origin is recorded with its framework and optional screenshot", () => {
  const dir = scaffold();
  writeOrigin(dir, "paywall", "update-required", { path: "../App/UpdateRequiredView.swift", framework: "swiftui" });
  writeOrigin(dir, "paywall", "rate-us", { path: "src/RateUs.tsx", framework: "react-native", screenshot: "original.png" });
  assert.deepEqual(readLock(dir).origins, {
    "paywall/update-required": { path: "../App/UpdateRequiredView.swift", framework: "swiftui" },
    "paywall/rate-us": { path: "src/RateUs.tsx", framework: "react-native", screenshot: "original.png" },
  });
});

test("a screen origin with an unknown framework or no path is dropped", () => {
  const dir = scaffold();
  fs.writeFileSync(
    path.join(dir, "superwall.lock"),
    JSON.stringify({
      version: 1,
      apps: {},
      paywalls: {},
      funnels: {},
      origins: {
        "paywall/a": { path: "x.kt", framework: "kotlin" },
        "paywall/b": { framework: "swiftui" },
        "paywall/c": { path: "x.swift", framework: "swiftui", screenshot: 1 },
        "paywall/d": { path: "d.swift", framework: "swiftui", screenshot: "../../etc/passwd" },
        "paywall/e": { path: "e.swift", framework: "swiftui", screenshot: ".hidden.png" },
        "paywall/f": { path: "f.swift", framework: "swiftui", screenshot: "" },
      },
    }),
  );
  assert.deepEqual(readLock(dir).origins, {
    "paywall/c": { path: "x.swift", framework: "swiftui" },
    "paywall/d": { path: "d.swift", framework: "swiftui" },
    "paywall/e": { path: "e.swift", framework: "swiftui" },
    "paywall/f": { path: "f.swift", framework: "swiftui" },
  });
});
