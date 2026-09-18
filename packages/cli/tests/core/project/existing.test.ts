import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Integration } from "@/environment";
import { detectExisting } from "@/core/project/existing";
import { frameworkByIntegration } from "@/core/project/frameworks";
import type { DetectedApp } from "@/core/project/scan";

function androidApp(files: Record<string, string>): DetectedApp {
  const dir = mkdtempSync(join(tmpdir(), "sw-existing-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  return {
    path: dir,
    relPath: ".",
    name: "app",
    framework: frameworkByIntegration[Integration.android],
    integration: Integration.android,
    score: 1,
  };
}

test("an Android app with the SDK in Gradle and configure in the Application is fully integrated", () => {
  const app = androidApp({
    "build.gradle.kts": 'dependencies { implementation("com.superwall.sdk:superwall-android:2.8.3") }',
    "src/main/java/com/acme/MainApplication.kt":
      'class MainApplication : Application() { override fun onCreate() { Superwall.configure(this, "pk_abc123def456") } }',
  });
  const existing = detectExisting(app);
  assert.equal(existing.sdkInstalled, true);
  assert.equal(existing.configureFound, true);
  assert.equal(existing.apiKey, "pk_abc123def456");
  assert.equal(existing.fullyIntegrated, true);
});

test("an Android app whose version catalog names the SDK but never configures it is half done", () => {
  const app = androidApp({
    "gradle/libs.versions.toml": '[libraries]\nsuperwall-android = { group = "com.superwall.sdk", name = "superwall-android", version = "2.8.3" }',
    "src/main/java/com/acme/MainActivity.kt": "class MainActivity : AppCompatActivity()",
  });
  const existing = detectExisting(app);
  assert.equal(existing.sdkInstalled, true);
  assert.equal(existing.configureFound, false);
  assert.equal(existing.apiKey, undefined);
  assert.equal(existing.fullyIntegrated, false);
});

test("an Android app without the SDK is not integrated", () => {
  const app = androidApp({ "build.gradle": "apply plugin: 'com.android.application'" });
  assert.equal(detectExisting(app).sdkInstalled, false);
});
