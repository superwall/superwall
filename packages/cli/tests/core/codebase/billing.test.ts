import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detectBilling } from "@/core/codebase/billing";
import type { DetectedApp } from "@/core/codebase/scan";

const dirs: string[] = [];

after(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function appWithFiles(files: Record<string, string>): DetectedApp {
  const dir = mkdtempSync(join(tmpdir(), "sw-billing-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return { path: dir } as DetectedApp;
}

function appWithDeps(deps: Record<string, string>): DetectedApp {
  return appWithFiles({ "package.json": JSON.stringify({ dependencies: deps }) });
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

test("native manifests name the provider without a package.json", () => {
  const swift = appWithFiles({
    "Acme.xcodeproj/project.pbxproj": "/* RevenueCat */ XCRemoteSwiftPackageReference",
  });
  const android = appWithFiles({
    "app/build.gradle.kts": 'implementation("io.adapty:android-sdk:3.0.0")\nimplementation("io.qonversion.android.sdk:sdk:8")',
  });

  assert.deepEqual(detectBilling(swift), { revenueCat: true, adapty: false, qonversion: false });
  assert.deepEqual(detectBilling(android), { revenueCat: false, adapty: true, qonversion: true });
});

test("a Podfile.lock naming every provider settles detection on its own", () => {
  const app = appWithFiles({
    "ios/Podfile.lock": "PODS:\n  - Adapty (3.0.0)\n  - Qonversion (5.0.0)\n  - RevenueCat (5.0.0)\n",
  });

  assert.deepEqual(detectBilling(app), { revenueCat: true, adapty: true, qonversion: true });
});

test("imports find providers that no manifest mentions, such as vendored SDKs", () => {
  const app = appWithFiles({
    "Sources/Paywall.swift": "import RevenueCat\nimport Adapty\n",
    "android/app/src/main/java/Billing.kt": "import com.qonversion.android.sdk.Qonversion\n",
  });

  assert.deepEqual(detectBilling(app), { revenueCat: true, adapty: true, qonversion: true });
});

test("build output and dependency folders are not scanned", () => {
  const app = appWithFiles({
    "Pods/RevenueCat/Podfile": "pod 'RevenueCat'",
    "node_modules/x/Sources/A.swift": "import Adapty",
    "build/generated/B.kt": "import com.qonversion.android.sdk.Qonversion",
  });

  assert.deepEqual(detectBilling(app), { revenueCat: false, adapty: false, qonversion: false });
});

test("an unreadable manifest or source file is skipped, not fatal", { skip: process.getuid?.() === 0 }, () => {
  const app = appWithFiles({
    Podfile: "pod 'RevenueCat'",
    "Sources/Paywall.swift": "import Adapty",
    "Sources/Readable.swift": "import Qonversion",
  });
  chmodSync(join(app.path, "Podfile"), 0o000);
  chmodSync(join(app.path, "Sources/Paywall.swift"), 0o000);

  assert.deepEqual(detectBilling(app), { revenueCat: false, adapty: false, qonversion: true });
});

test("a Flutter app's pubspec names RevenueCat by its package", () => {
  const flutter = appWithFiles({ "pubspec.yaml": "dependencies:\n  purchases_flutter: ^8.0.0\n" });
  assert.deepEqual(detectBilling(flutter), { revenueCat: true, adapty: false, qonversion: false });
});
