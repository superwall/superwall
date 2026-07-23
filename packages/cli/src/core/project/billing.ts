import { readFileSync } from "node:fs";
import fg from "fast-glob";
import type { DetectedApp } from "./scan";
import { allDeps, readPackageJson } from "@/util/fs";

export interface BillingDetection {
  revenueCat: boolean;
  adapty: boolean;
  qonversion: boolean;
}

const IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/Pods/**",
  "**/build/**",
  "**/.build/**",
  "**/dist/**",
];

export function detectBilling(app: DetectedApp): BillingDetection {
  const deps = allDeps(readPackageJson(app.path));
  const inDeps = (names: string[]) => names.some((n) => n in deps);

  let revenueCat = inDeps([
    "react-native-purchases",
    "@revenuecat/purchases-js",
    "purchases-capacitor",
    "purchases_flutter",
  ]);
  let adapty = inDeps(["react-native-adapty", "adapty_flutter"]);
  let qonversion = inDeps(["react-native-qonversion", "qonversion_flutter"]);

  const manifests = fg.sync(
    [
      "**/Package.resolved",
      "**/Package.swift",
      "**/Project.swift",
      "**/Podfile",
      "**/Podfile.lock",
      "**/project.pbxproj",
      "**/*.gradle",
      "**/*.gradle.kts",
      "**/pubspec.yaml",
      "**/pubspec.lock",
    ],
    { cwd: app.path, ignore: IGNORE, absolute: true, deep: 5 },
  );
  for (const f of manifests) {
    let c: string;
    try {
      c = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (/RevenueCat|\bPurchases\b/i.test(c)) revenueCat = true;
    if (/Adapty/i.test(c)) adapty = true;
    if (/Qonversion/i.test(c)) qonversion = true;
  }

  // Manifests can miss (Tuist, vendored SDKs) - source imports are the strongest signal.
  if (!revenueCat || !adapty || !qonversion) {
    const sources = fg
      .sync(["**/*.swift", "**/*.kt"], {
        cwd: app.path,
        ignore: IGNORE,
        absolute: true,
        deep: 6,
      })
      .slice(0, 600);
    for (const f of sources) {
      let c: string;
      try {
        c = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      if (/import RevenueCat|com\.revenuecat/.test(c)) revenueCat = true;
      if (/import Adapty|com\.adapty/.test(c)) adapty = true;
      if (/import Qonversion|com\.qonversion/.test(c)) qonversion = true;
    }
  }

  return { revenueCat, adapty, qonversion };
}
