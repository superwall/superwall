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

test("detects an Android app module from its Gradle plugin, telling Compose from Views", async () => {
  const dir = tmp();
  mkdirSync(join(dir, "app", "src", "main", "java", "com", "acme"), { recursive: true });
  writeFileSync(join(dir, "settings.gradle.kts"), 'include(":app")');
  writeFileSync(join(dir, "build.gradle.kts"), "plugins { id(\"com.android.application\") version \"8.5.0\" apply false }");
  writeFileSync(
    join(dir, "app", "build.gradle.kts"),
    'plugins { id("com.android.application") }\ndependencies { implementation(platform("androidx.compose:compose-bom:2024.09.00")) }',
  );
  const scan = await scanProject(dir);
  assert.equal(scan.apps.length, 1);
  assert.equal(scan.apps[0]?.integration, "android");
  assert.equal(scan.apps[0]?.relPath, "app");
  assert.equal(scan.apps[0]?.details, "Jetpack Compose");
  assert.equal(scan.apps[0]?.framework.sdkPackage, "com.superwall.sdk:superwall-android");

  const views = tmp();
  mkdirSync(join(views, "app", "src"), { recursive: true });
  writeFileSync(join(views, "app", "build.gradle"), "apply plugin: 'com.android.application'\n");
  writeFileSync(join(views, "app", "src", "Main.kt"), "class MainActivity : AppCompatActivity()");
  const scanned = await scanProject(views);
  assert.equal(scanned.apps[0]?.integration, "android");
  assert.equal(scanned.apps[0]?.details, "Views");
});

test("a generated android/ module inside an Expo or Flutter app is not a separate Android app", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { expo: "52.0.0" } }));
  mkdirSync(join(dir, "android", "app"), { recursive: true });
  writeFileSync(join(dir, "android", "app", "build.gradle"), "apply plugin: \"com.android.application\"");
  const scan = await scanProject(dir);
  assert.equal(scan.apps.length, 1);
  assert.equal(scan.apps[0]?.integration, "expo");

  const flutter = tmp();
  writeFileSync(join(flutter, "pubspec.yaml"), "name: acme\ndependencies:\n  flutter:\n    sdk: flutter\n");
  mkdirSync(join(flutter, "android", "app"), { recursive: true });
  writeFileSync(join(flutter, "android", "app", "build.gradle.kts"), 'plugins { id("com.android.application") }');
  const scanned = await scanProject(flutter);
  assert.deepEqual(scanned.apps.map((app) => app.integration), ["flutter"]);
});

test("Compose is recognised from the sources when Gradle does not say", async () => {
  const dir = tmp();
  mkdirSync(join(dir, "app", "src", "main", "java"), { recursive: true });
  writeFileSync(join(dir, "app", "build.gradle.kts"), 'plugins { id("com.android.application") }');
  writeFileSync(join(dir, "app", "src", "main", "java", "Home.kt"), "@Composable\nfun Home() {}");
  const scan = await scanProject(dir);
  assert.equal(scan.apps[0]?.details, "Jetpack Compose");
});
