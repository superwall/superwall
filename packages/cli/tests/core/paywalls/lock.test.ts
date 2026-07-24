import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { readLock, writeApplicationId, writeBinding } from "@/core/paywalls/lock";

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

test("readLock returns an empty lock when the file is missing", () => {
  assert.deepEqual(readLock(scaffold()), { version: 1, paywalls: {}, funnels: {} });
});

test("bindings and the application id round-trip and merge", () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", { paywallId: "208540" });
  writeBinding(dir, "funnel", "onboarding", { paywallId: "300001" });
  writeApplicationId(dir, "7");

  const lock = readLock(dir);
  assert.deepEqual(lock.paywalls["plus-upgrade"], { paywallId: "208540" });
  assert.deepEqual(lock.funnels.onboarding, { paywallId: "300001" });
  assert.equal(lock.applicationId, "7");

  writeBinding(dir, "paywall", "plus-upgrade", { paywallId: "999999" });
  const rewritten = readLock(dir);
  assert.deepEqual(rewritten.paywalls["plus-upgrade"], { paywallId: "999999" });
  assert.equal(rewritten.applicationId, "7");
});

test("corrupt or wrong-version lock files read as unbound", () => {
  const dir = scaffold();
  fs.writeFileSync(path.join(dir, "superwall.lock"), "not json {");
  assert.deepEqual(readLock(dir), { version: 1, paywalls: {}, funnels: {} });

  fs.writeFileSync(path.join(dir, "superwall.lock"), JSON.stringify({ version: 2 }));
  assert.deepEqual(readLock(dir), { version: 1, paywalls: {}, funnels: {} });
});
