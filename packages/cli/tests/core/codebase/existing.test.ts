import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Integration } from "@/environment";
import { detectExisting } from "@/core/codebase/existing";
import { frameworkByIntegration } from "@/core/codebase/frameworks";
import type { DetectedApp } from "@/core/codebase/scan";

const dirs: string[] = [];

after(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function appOf(integration: Integration, files: Record<string, string>): DetectedApp {
  const dir = mkdtempSync(join(tmpdir(), "sw-existing-"));
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  return {
    path: dir,
    relPath: ".",
    name: "app",
    framework: frameworkByIntegration[integration],
    integration,
    score: 1,
  };
}

function androidApp(files: Record<string, string>): DetectedApp {
  return appOf(Integration.android, files);
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

test("an Expo app with expo-superwall and a provider reading the key from .env is integrated", () => {
  const app = appOf(Integration.expo, {
    "package.json": JSON.stringify({ dependencies: { expo: "52.0.0", "expo-superwall": "1.0.0" } }),
    "app/_layout.tsx": "export default () => <SuperwallProvider apiKeys={{ ios: process.env.KEY }} />",
    ".env": "EXPO_PUBLIC_SUPERWALL_KEY=pk_live_9f8e7d6c",
  });

  assert.deepEqual(detectExisting(app), {
    sdkInstalled: true,
    configureFound: true,
    apiKey: "pk_live_9f8e7d6c",
    fullyIntegrated: true,
  });
});

test("a React Native app without the package falls back to its native manifests", () => {
  const app = appOf(Integration.reactNative, {
    "package.json": JSON.stringify({ dependencies: { "react-native": "0.76.0" } }),
    "ios/Podfile": "pod 'SuperwallKit'",
  });
  const bare = appOf(Integration.reactNative, {
    "package.json": JSON.stringify({ dependencies: { "react-native": "0.76.0" } }),
  });

  assert.equal(detectExisting(app).sdkInstalled, true);
  assert.equal(detectExisting(bare).sdkInstalled, false);
});

test("the first key and configure call win, wherever each is found", () => {
  const app = appOf(Integration.swift, {
    "Config/Release.xcconfig": "SUPERWALL_KEY = pk_from_xcconfig",
    "Sources/App.swift": 'Superwall.configure(apiKey: "pk_from_source")',
    "Sources/Other.swift": "Superwall.shared.configure()",
  });

  const existing = detectExisting(app);

  assert.equal(existing.configureFound, true);
  assert.match(existing.apiKey ?? "", /^pk_from_(xcconfig|source)$/);
  assert.equal(existing.sdkInstalled, false);
  assert.equal(existing.fullyIntegrated, false);
});

test("unreadable manifests and sources are skipped", { skip: process.getuid?.() === 0 }, () => {
  const app = appOf(Integration.flutter, {
    "pubspec.yaml": "dependencies:\n  superwallkit_flutter: ^2.0.0\n",
    "lib/main.dart": 'Superwall.configure("pk_hidden_123456");',
  });
  chmodSync(join(app.path, "pubspec.yaml"), 0o000);
  chmodSync(join(app.path, "lib/main.dart"), 0o000);

  assert.deepEqual(detectExisting(app), {
    sdkInstalled: false,
    configureFound: false,
    apiKey: undefined,
    fullyIntegrated: false,
  });
});
