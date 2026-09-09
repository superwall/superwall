import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";

const IGNORED_SCHEMES = new Set(["http", "https", "file", "mailto", "tel", "sms"]);

const IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/Pods/**",
  "**/build/**",
  "**/DerivedData/**",
  "**/.expo/**",
  "**/dist/**",
];

const usable = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || IGNORED_SCHEMES.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
};

export const schemeFromInfoPlist = (contents: string): string | undefined => {
  const block = /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(contents);
  if (!block?.[1]) return undefined;
  for (const match of block[1].matchAll(/<string>([^<]*)<\/string>/g)) {
    const scheme = usable(match[1]);
    if (scheme !== undefined) return scheme;
  }
  return undefined;
};

export const schemeFromExpoConfig = (contents: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as { scheme?: unknown; expo?: { scheme?: unknown } };
    const value = record.expo?.scheme ?? record.scheme;
    if (typeof value === "string") return usable(value);
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") {
          const scheme = usable(entry);
          if (scheme !== undefined) return scheme;
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
};

export const schemeFromAndroidManifest = (contents: string): string | undefined => {
  for (const match of contents.matchAll(/android:scheme="([^"]*)"/g)) {
    const scheme = usable(match[1]);
    if (scheme !== undefined) return scheme;
  }
  return undefined;
};

export const allowsLocalNetworking = (contents: string): boolean => {
  const block = /<key>NSAppTransportSecurity<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(contents);
  if (!block?.[1]) return false;
  const keys = block[1];
  const enabled = (key: string) =>
    new RegExp(`<key>${key}</key>\\s*<true\\s*/>`).test(keys);
  return (
    enabled("NSAllowsArbitraryLoads") ||
    (enabled("NSAllowsLocalNetworking") && enabled("NSAllowsArbitraryLoadsInWebContent"))
  );
};

export const detectAppTransportSecurity = async (
  roots: string | readonly string[],
): Promise<{ plist: string; allowed: boolean } | undefined> => {
  const dirs = (typeof roots === "string" ? [roots] : roots).map((dir) => path.resolve(dir));
  for (const dir of dirs) {
    const files = await fg("**/Info.plist", {
      cwd: dir,
      absolute: true,
      ignore: IGNORE,
      deep: 6,
      suppressErrors: true,
    });
    for (const file of files.sort()) {
      try {
        const contents = fs.readFileSync(file, "utf8");
        if (!contents.includes("CFBundleURLTypes") && !contents.includes("CFBundleIdentifier")) {
          continue;
        }
        return { plist: file, allowed: allowsLocalNetworking(contents) };
      } catch {
        continue;
      }
    }
  }
  return undefined;
};

const READERS: ReadonlyArray<readonly [string, (contents: string) => string | undefined]> = [
  ["**/Info.plist", schemeFromInfoPlist],
  ["**/app.json", schemeFromExpoConfig],
  ["**/app.config.json", schemeFromExpoConfig],
  ["**/AndroidManifest.xml", schemeFromAndroidManifest],
];

export const detectLocalScheme = async (
  roots: string | readonly string[],
): Promise<string | undefined> => {
  const dirs = (typeof roots === "string" ? [roots] : roots).map((dir) => path.resolve(dir));
  for (const [pattern, read] of READERS) {
    for (const dir of dirs) {
      const files = await fg(pattern, {
        cwd: dir,
        absolute: true,
        ignore: IGNORE,
        deep: 6,
        suppressErrors: true,
      });
      for (const file of files.sort()) {
        try {
          const scheme = read(fs.readFileSync(file, "utf8"));
          if (scheme !== undefined) return scheme;
        } catch {
          continue;
        }
      }
    }
  }
  return undefined;
};

const APP_MARKERS = [
  "package.json",
  "app.json",
  "app.config.json",
  "Podfile",
  "ios",
  "android",
  ".git",
];

const looksLikeAppRoot = (dir: string): boolean => {
  if (APP_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)))) return true;
  try {
    return fs
      .readdirSync(dir)
      .some((entry) => entry.endsWith(".xcodeproj") || entry.endsWith(".xcworkspace"));
  } catch {
    return false;
  }
};

export const schemeSearchRoots = (project: {
  root: string;
  superwallDir: string;
}): string[] => {
  const root = path.resolve(project.root);
  const superwallDir = path.resolve(project.superwallDir);
  const roots = [root];
  const parent = path.dirname(root);
  if (root === superwallDir && parent !== root && looksLikeAppRoot(parent)) roots.push(parent);
  return roots;
};

export const appScheme = async (
  roots: string | readonly string[],
  remote: () => Promise<string | null | undefined>,
): Promise<{ scheme?: string; source?: "dashboard" | "app" }> => {
  const fromDashboard = usable(await remote().catch(() => undefined));
  if (fromDashboard !== undefined) {
    return { scheme: fromDashboard, source: "dashboard" };
  }
  const local = await detectLocalScheme(roots).catch(() => undefined);
  return local === undefined ? {} : { scheme: local, source: "app" };
};
