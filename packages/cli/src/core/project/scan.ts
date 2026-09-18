import { basename, dirname, join, relative, sep } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";
import { Integration } from "@/environment";
import type { Framework } from "@/core/project/frameworks";
import { frameworkByIntegration } from "./frameworks";
import { allDeps, readPackageJson } from "@/core/project/package";

export interface DetectedApp {
  path: string;
  relPath: string;
  name: string;
  framework: Framework;
  integration: Integration;
  details?: string;
  score: number;
}

export interface ScanResult {
  root: string;
  isMonorepo: boolean;
  apps: DetectedApp[];
  unsupported: DetectedApp[];
  skipped: string[];
}

const IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.build/**",
  "**/DerivedData/**",
  "**/Pods/**",
  "**/build/**",
  "**/dist/**",
  "**/.next/**",
  "**/.expo/**",
  "**/vendor/**",
  "**/.turbo/**",
];

const SCAN_DEPTH = 6;

const FRONTEND_DEPS = [
  "next",
  "nuxt",
  "astro",
  "@sveltejs/kit",
  "@angular/core",
  "@remix-run/react",
  "@tanstack/react-start",
  "gatsby",
  "vite",
  "react-dom",
  "vue",
  "svelte",
  "solid-js",
  "preact",
];

interface Classification {
  integration: Integration;
  details?: string;
  score: number;
}

function classifyJs(dir: string): Classification | null {
  const pkg = readPackageJson(dir);
  if (!pkg) return null;
  const deps = allDeps(pkg);
  if ("expo" in deps)
    return {
      integration: Integration.expo,
      details: `Expo ${deps.expo}`,
      score: 0.96,
    };
  if ("react-native" in deps)
    return {
      integration: Integration.reactNative,
      details: deps["react-native"],
      score: 0.9,
    };
  const fe = FRONTEND_DEPS.find((d) => d in deps);
  if (fe) return { integration: Integration.web, details: fe, score: 0.7 };
  return null;
}

function androidUiKind(dir: string, gradle: string): string {
  if (/androidx\.compose|compose-bom|compose\.ui|kotlin\("plugin\.compose"\)|org\.jetbrains\.kotlin\.plugin\.compose/.test(gradle)) {
    return "Jetpack Compose";
  }
  const files = fg.sync("**/*.kt", { cwd: dir, ignore: IGNORE, absolute: true, deep: 8 });
  for (const f of files.slice(0, 300)) {
    try {
      if (readFileSync(f, "utf8").includes("@Composable")) return "Jetpack Compose";
    } catch {
      /* ignore */
    }
  }
  return "Views";
}

const ANDROID_APP_PLUGIN = /com\.android\.application|alias\(libs\.plugins\.android\.application\)|libs\.plugins\.androidApplication/;

function swiftUiKind(dir: string): string {
  const files = fg.sync("**/*.swift", {
    cwd: dir,
    ignore: IGNORE,
    absolute: true,
    deep: 6,
  });
  let swiftui = false;
  let uikit = false;
  for (const f of files.slice(0, 300)) {
    try {
      const c = readFileSync(f, "utf8");
      if (c.includes("import SwiftUI")) swiftui = true;
      else if (c.includes("import UIKit")) uikit = true;
    } catch {
      /* ignore */
    }
    if (swiftui) break;
  }
  if (swiftui) return "SwiftUI";
  if (uikit) return "UIKit";
  return "Swift";
}

// A native project under a JS app root is a generated project (Expo prebuild / RN), not a standalone Swift app.
function isGeneratedNative(swiftDir: string, jsRoots: Set<string>): boolean {
  const segs = swiftDir.split(sep);
  if (!segs.includes("ios") && !segs.includes("android")) return false;
  let cur = swiftDir;
  while (true) {
    const parent = dirname(cur);
    if (parent === cur) break;
    if (jsRoots.has(parent)) return true;
    cur = parent;
  }
  return false;
}

function isLibraryPath(dir: string): boolean {
  return (
    dir.includes(`${sep}packages${sep}`) ||
    dir.includes(`${sep}libs${sep}`) ||
    dir.includes(`${sep}node_modules${sep}`)
  );
}

function makeApp(root: string, dir: string, c: Classification): DetectedApp {
  const rel = relative(root, dir) || ".";
  return {
    path: dir,
    relPath: rel,
    name: rel === "." ? basename(root) : basename(dir),
    framework: frameworkByIntegration[c.integration],
    integration: c.integration,
    details: c.details,
    score: c.score,
  };
}

function looksLikeMonorepoRoot(root: string): boolean {
  return (
    existsSync(join(root, "turbo.json")) ||
    existsSync(join(root, "pnpm-workspace.yaml")) ||
    existsSync(join(root, "nx.json")) ||
    existsSync(join(root, "lerna.json")) ||
    Array.isArray((readPackageJson(root) ?? {}).workspaces) ||
    typeof (readPackageJson(root) ?? {}).workspaces === "object"
  );
}

export async function scanProject(root: string): Promise<ScanResult> {
  const opts = { cwd: root, ignore: IGNORE, deep: SCAN_DEPTH } as const;
  const [pkgPaths, xcodeProjects, packageSwifts, tuistProjects, pubspecs, gradles] = await Promise.all([
    fg("**/package.json", opts),
    fg("**/*.xcodeproj", { ...opts, onlyDirectories: true }),
    fg("**/Package.swift", opts),
    fg("**/Project.swift", opts),
    fg("**/pubspec.yaml", opts),
    fg("**/build.gradle{,.kts}", opts),
  ]);

  const jsRoots = pkgPaths.map((p) => dirname(join(root, p)));
  const jsRootSet = new Set(jsRoots);

  const apps: DetectedApp[] = [];
  const skipped: string[] = [];

  for (const dir of jsRoots) {
    if (isLibraryPath(dir)) continue;
    const c = classifyJs(dir);
    if (c) apps.push(makeApp(root, dir, c));
    else if (dir !== root) skipped.push(basename(dir));
  }

  const swiftDirs = new Set<string>();
  for (const x of xcodeProjects) swiftDirs.add(dirname(join(root, x)));
  for (const s of packageSwifts) {
    const dir = dirname(join(root, s));
    // Tuist/Package.swift is Tuist's dependency manifest, not an app.
    if (basename(dir) === "Tuist") continue;
    swiftDirs.add(dir);
  }
  // Tuist projects: Project.swift is the manifest, the app lives at its dir.
  for (const t of tuistProjects) swiftDirs.add(dirname(join(root, t)));
  for (const dir of swiftDirs) {
    if (isGeneratedNative(dir, jsRootSet)) continue;
    apps.push(
      makeApp(root, dir, {
        integration: Integration.swift,
        details: swiftUiKind(dir),
        score: 0.95,
      }),
    );
  }

  const nativeRoots = new Set([...jsRootSet, ...pubspecs.map((p) => dirname(join(root, p)))]);
  for (const g of gradles) {
    const file = join(root, g);
    let gradle: string;
    try {
      gradle = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const applies = gradle
      .split("\n")
      .some((line) => ANDROID_APP_PLUGIN.test(line) && !/apply\s+false/.test(line));
    if (!applies) continue;
    const moduleDir = dirname(file);
    if (isGeneratedNative(moduleDir, nativeRoots)) continue;
    apps.push(
      makeApp(root, moduleDir, {
        integration: Integration.android,
        details: androidUiKind(moduleDir, gradle),
        score: 0.95,
      }),
    );
  }

  for (const p of pubspecs) {
    const dir = dirname(join(root, p));
    apps.push(makeApp(root, dir, { integration: Integration.flutter, score: 0.9 }));
  }

  const byPath = new Map<string, DetectedApp>();
  for (const app of apps) {
    const prev = byPath.get(app.path);
    if (!prev || app.score > prev.score) byPath.set(app.path, app);
  }
  const deduped = [...byPath.values()].sort((a, b) => b.score - a.score);

  const supported = deduped.filter((a) => a.framework.supported);
  const unsupported = deduped.filter((a) => !a.framework.supported);

  return {
    root,
    isMonorepo: looksLikeMonorepoRoot(root) || deduped.length > 1,
    apps: supported,
    unsupported,
    skipped: [...new Set(skipped)],
  };
}
