import { readFileSync } from "node:fs";
import fg from "fast-glob";
import { Integration } from "@/environment";
import type { DetectedApp } from "./scan";
import { allDeps, readPackageJson } from "@/core/project/package";

export interface ExistingIntegration {
  sdkInstalled: boolean;
  configureFound: boolean;
  apiKey?: string;
  fullyIntegrated: boolean;
}

const JS_SDK_PACKAGES: Partial<Record<Integration, string[]>> = {
  [Integration.expo]: ["expo-superwall"],
  [Integration.reactNative]: ["@superwall/react-native-superwall", "react-native-superwall"],
  [Integration.web]: ["@superwall/web", "superwall-js"],
};

const PK_RE = /pk_[A-Za-z0-9._-]{6,}/;
const CONFIGURE_RE =
  /Superwall\.(shared\.)?configure|configureSuperwall|SuperwallProvider|\.configure\(\s*apiKey/;
const SDK_REF_RE = /Superwall-iOS|SuperwallKit|superwallkit_flutter|expo-superwall|superwall/i;

const SOURCE_GLOBS = ["**/*.{swift,ts,tsx,js,jsx,kt,dart}", "**/.env*", "**/*.xcconfig"];
const IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/Pods/**",
  "**/build/**",
  "**/.build/**",
  "**/DerivedData/**",
  "**/dist/**",
  "**/.next/**",
];
const MAX_FILES = 600;

function sdkInstalledFor(app: DetectedApp): boolean {
  const jsPkgs = JS_SDK_PACKAGES[app.integration];
  if (jsPkgs) {
    const deps = allDeps(readPackageJson(app.path));
    if (jsPkgs.some((p) => p in deps)) return true;
  }
  const manifests = fg.sync(
    [
      "**/Package.resolved",
      "**/project.pbxproj",
      "**/Podfile",
      "**/pubspec.yaml",
      "**/pubspec.lock",
    ],
    { cwd: app.path, ignore: IGNORE, absolute: true, deep: 5 },
  );
  for (const f of manifests) {
    try {
      if (SDK_REF_RE.test(readFileSync(f, "utf8"))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function detectExisting(app: DetectedApp): ExistingIntegration {
  const sdkInstalled = sdkInstalledFor(app);

  let configureFound = false;
  let apiKey: string | undefined;

  const files = fg.sync(SOURCE_GLOBS, {
    cwd: app.path,
    ignore: IGNORE,
    absolute: true,
    deep: 6,
    dot: true,
  });
  for (const f of files.slice(0, MAX_FILES)) {
    let content: string;
    try {
      content = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (!configureFound && CONFIGURE_RE.test(content)) configureFound = true;
    if (!apiKey) {
      const m = content.match(PK_RE);
      if (m) apiKey = m[0];
    }
    if (configureFound && apiKey) break;
  }

  return {
    sdkInstalled,
    configureFound,
    apiKey,
    fullyIntegrated: sdkInstalled && configureFound,
  };
}
