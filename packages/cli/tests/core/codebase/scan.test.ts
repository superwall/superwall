import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { scanProject } from "@/core/codebase/scan";

const dirs: string[] = [];

after(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-scan-"));
  dirs.push(dir);
  return dir;
}

function tree(files: Record<string, string>): string {
  const root = tmp();
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

const pkg = (deps: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ dependencies: deps, ...extra });

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

test("an Xcode project is a Swift app named by its UI framework", async () => {
  const swiftui = tree({
    "Acme.xcodeproj/project.pbxproj": "",
    "Acme/App.swift": "import SwiftUI\n@main struct AcmeApp: App {}",
    "Acme/Legacy.swift": "import UIKit",
  });
  const uikit = tree({ "Acme.xcodeproj/project.pbxproj": "", "Acme/AppDelegate.swift": "import UIKit" });
  const plain = tree({ "Acme.xcodeproj/project.pbxproj": "", "Acme/Model.swift": "struct Model {}" });

  const [a, b, c] = await Promise.all([scanProject(swiftui), scanProject(uikit), scanProject(plain)]);

  assert.deepEqual(
    a.apps.map((app) => [app.integration, app.details, app.relPath, app.name]),
    [["swift", "SwiftUI", ".", basename(swiftui)]],
  );
  assert.equal(a.isMonorepo, false);
  assert.equal(b.apps[0]?.details, "UIKit");
  assert.equal(c.apps[0]?.details, "Swift");
});

test("Swift packages and Tuist projects are found, but a Tuist manifest folder is not an app", async () => {
  const root = tree({
    "Kit/Package.swift": "// swift-tools-version:5.9",
    "Tuist/Package.swift": "// swift-tools-version:5.9",
    "App/Project.swift": "import ProjectDescription",
  });

  const scan = await scanProject(root);

  assert.deepEqual(scan.apps.map((app) => app.relPath).sort(), ["App", "Kit"]);
  assert.ok(scan.apps.every((app) => app.integration === "swift"));
  assert.equal(scan.isMonorepo, true);
});

test("a Swift file that can't be read is skipped when naming the UI framework", { skip: process.getuid?.() === 0 }, async () => {
  const root = tree({
    "Acme.xcodeproj/project.pbxproj": "",
    "Acme/App.swift": "import SwiftUI",
  });
  chmodSync(join(root, "Acme/App.swift"), 0o000);

  const scan = await scanProject(root);

  assert.equal(scan.apps[0]?.details, "Swift");
});

test("an Android module whose Gradle file can't be read is skipped", { skip: process.getuid?.() === 0 }, async () => {
  const root = tree({ "app/build.gradle": "apply plugin: 'com.android.application'" });
  chmodSync(join(root, "app/build.gradle"), 0o000);

  const scan = await scanProject(root);

  assert.deepEqual(scan.apps, []);
});

test("an unreadable Kotlin file doesn't stop the Compose search", { skip: process.getuid?.() === 0 }, async () => {
  const root = tree({
    "app/build.gradle.kts": 'plugins { id("com.android.application") }',
    "app/src/A.kt": "@Composable fun A() {}",
  });
  chmodSync(join(root, "app/src/A.kt"), 0o000);

  const scan = await scanProject(root);

  assert.equal(scan.apps[0]?.details, "Views");
});

test("a library module that only declares the plugin apply false is not an app", async () => {
  const root = tree({
    "build.gradle.kts": 'plugins {\n  alias(libs.plugins.android.application) apply false\n}',
    "lib/build.gradle.kts": 'plugins { id("com.android.library") }',
  });

  assert.deepEqual((await scanProject(root)).apps, []);
});

test("a React Native app reports its version; packages without an app framework are skipped by name", async () => {
  const root = tree({
    "package.json": pkg({}, { workspaces: ["apps/*"] }),
    "apps/mobile/package.json": pkg({ "react-native": "0.76.0" }),
    "apps/tooling/package.json": JSON.stringify({ devDependencies: { typescript: "5" } }),
    "apps/broken/package.json": "{ not json",
    "packages/ui/package.json": pkg({ expo: "52.0.0" }),
  });

  const scan = await scanProject(root);

  assert.deepEqual(
    scan.apps.map((app) => [app.relPath, app.integration, app.details, app.name]),
    [[join("apps", "mobile"), "react-native", "0.76.0", "mobile"]],
  );
  assert.deepEqual(scan.skipped.sort(), ["broken", "tooling"]);
  assert.equal(scan.isMonorepo, true);
});

test("monorepo markers make a single-app root a monorepo", async () => {
  for (const marker of ["turbo.json", "pnpm-workspace.yaml", "nx.json", "lerna.json"]) {
    const root = tree({ [marker]: "{}", "apps/mobile/package.json": pkg({ expo: "52.0.0" }) });
    const scan = await scanProject(root);
    assert.equal(scan.isMonorepo, true, marker);
    assert.equal(scan.apps.length, 1, marker);
  }
  const single = await scanProject(tree({ "package.json": pkg({ expo: "52.0.0" }) }));
  assert.equal(single.isMonorepo, false);
});

test("apps are ranked by confidence, keeping the best reading of each folder", async () => {
  const root = tree({
    "mobile/package.json": pkg({ expo: "52.0.0" }),
    "mobile/pubspec.yaml": "name: confused",
    "shop/package.json": pkg({ vite: "5" }),
    "flutter_app/pubspec.yaml": "name: acme",
  });

  const scan = await scanProject(root);

  assert.deepEqual(
    scan.apps.map((app) => [app.relPath, app.integration]),
    [
      ["mobile", "expo"],
      ["flutter_app", "flutter"],
    ],
  );
  assert.deepEqual(scan.unsupported.map((app) => [app.relPath, app.integration, app.details]), [["shop", "web", "vite"]]);
});

test("a native ios folder with no JavaScript app above it is its own Swift app", async () => {
  const root = tree({ "ios/Acme.xcodeproj/project.pbxproj": "", "ios/Acme/App.swift": "import SwiftUI" });

  const scan = await scanProject(root);

  assert.deepEqual(scan.apps.map((app) => [app.relPath, app.integration]), [["ios", "swift"]]);
});

test("a later, more confident reading of the same folder replaces the earlier one", async () => {
  const root = tree({
    "package.json": pkg({ vite: "5" }),
    "Acme.xcodeproj/project.pbxproj": "",
  });

  const scan = await scanProject(root);

  assert.deepEqual(scan.apps.map((app) => [app.relPath, app.integration]), [[".", "swift"]]);
  assert.deepEqual(scan.unsupported, []);
});
