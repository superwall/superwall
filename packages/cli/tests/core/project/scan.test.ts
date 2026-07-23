import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "@/core/project/scan";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "sw-scan-"));
}

test("detects an Expo app", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { expo: "52.0.0" } }));
  writeFileSync(join(dir, "app.json"), "{}");
  const scan = await scanProject(dir);
  assert.equal(scan.apps[0]?.integration, "expo");
});

test("a web-only project is unsupported", async () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ dependencies: { next: "14.0.0", "react-dom": "18" } }),
  );
  const scan = await scanProject(dir);
  assert.equal(scan.apps.length, 0);
  assert.equal(scan.unsupported[0]?.integration, "web");
});

test("a generated ios/*.xcodeproj inside an RN app is not a separate Swift app", async () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ dependencies: { "react-native": "0.75.0" } }),
  );
  mkdirSync(join(dir, "ios", "App.xcodeproj"), { recursive: true });
  writeFileSync(join(dir, "ios", "App.xcodeproj", "project.pbxproj"), "");
  const scan = await scanProject(dir);
  assert.equal(scan.apps.length, 1);
  assert.equal(scan.apps[0]?.integration, "react-native");
});
