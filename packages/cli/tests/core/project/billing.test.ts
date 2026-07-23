import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectBilling } from "@/core/project/billing";
import type { DetectedApp } from "@/core/project/scan";

function appWithDeps(deps: Record<string, string>): DetectedApp {
  const dir = mkdtempSync(join(tmpdir(), "sw-billing-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: deps }));
  return { path: dir } as DetectedApp;
}

test("detects RevenueCat from react-native-purchases", () => {
  const b = detectBilling(appWithDeps({ "react-native-purchases": "8.0.0" }));
  assert.equal(b.revenueCat, true);
  assert.equal(b.adapty, false);
});

test("detects Adapty + Qonversion", () => {
  assert.equal(detectBilling(appWithDeps({ "react-native-adapty": "2.0.0" })).adapty, true);
  assert.equal(detectBilling(appWithDeps({ "react-native-qonversion": "8.0.0" })).qonversion, true);
});

test("no billing provider for a plain app", () => {
  const b = detectBilling(appWithDeps({ expo: "52.0.0" }));
  assert.equal(b.revenueCat, false);
  assert.equal(b.adapty, false);
  assert.equal(b.qonversion, false);
});
