import * as fs from "node:fs";
import * as path from "node:path";

export type DiscoveredPage = {
  route: string;
  file: string;
};

export type DiscoveredMessages = {
  locale: string;
  file: string;
};

export type SurfaceKind = "paywall" | "funnel";

export type DiscoveredSurface = {
  kind: SurfaceKind;
  id: string;
  dir: string;
  configFile: string;
  layoutFile?: string;
  pages: DiscoveredPage[];
  messages: DiscoveredMessages[];
};

export type ProjectMarker = "package.json";

export type Project = {
  root: string;
  superwallDir: string;
  marker?: ProjectMarker;
  packageName?: string;
  sharedMessages: DiscoveredMessages[];
  surfaces: DiscoveredSurface[];
  diagnostics: string[];
};

const SURFACE_ID = /^[a-z0-9][a-z0-9-]*$/;

const fileIfExists = (file: string): string | undefined => (fs.existsSync(file) ? file : undefined);

const listDirs = (parent: string): string[] =>
  fs.existsSync(parent)
    ? fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted()
    : [];

const discoverMessages = (dir: string): DiscoveredMessages[] => {
  const messagesDir = path.join(dir, "messages");
  if (!fs.existsSync(messagesDir)) return [];
  return fs
    .readdirSync(messagesDir)
    .filter((file) => file.endsWith(".ts"))
    .toSorted()
    .map((file) => ({ locale: path.basename(file, ".ts"), file: path.join(messagesDir, file) }));
};

const discoverPages = (appDir: string, base = "/"): DiscoveredPage[] => {
  if (!fs.existsSync(appDir)) return [];
  const pages: DiscoveredPage[] = [];
  const page = fileIfExists(path.join(appDir, "page.tsx"));
  if (page) pages.push({ route: base, file: page });

  for (const segment of listDirs(appDir)) {
    const route = base === "/" ? `/${segment}` : `${base}/${segment}`;
    pages.push(...discoverPages(path.join(appDir, segment), route));
  }
  return pages;
};

const discoverSurface = (
  kind: SurfaceKind,
  id: string,
  dir: string,
  diagnostics: string[],
): DiscoveredSurface | undefined => {
  if (!SURFACE_ID.test(id)) {
    diagnostics.push(`${kind}s/${id}: IDs must be lowercase kebab-case`);
    return undefined;
  }
  const pages = discoverPages(path.join(dir, "app"));
  if (pages.length === 0) {
    diagnostics.push(`${kind}s/${id}: missing app/page.tsx`);
    return undefined;
  }
  const configFile = fileIfExists(path.join(dir, "config.ts"));
  if (!configFile) {
    diagnostics.push(`${kind}s/${id} has no config.ts — every ${kind} needs one (definePaywall)`);
    return undefined;
  }
  return {
    kind,
    id,
    dir,
    configFile,
    layoutFile: fileIfExists(path.join(dir, "app/layout.tsx")),
    pages,
    messages: discoverMessages(dir),
  };
};

type ProjectPackage = { name?: string; dependsOnFramework: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readProjectPackage = (dir: string): ProjectPackage | undefined => {
  const file = path.join(dir, "package.json");
  if (!fs.existsSync(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const dependsOnFramework = ["dependencies", "devDependencies", "peerDependencies"].some(
    (field) => {
      const group = parsed[field];
      return isRecord(group) && "superwall" in group;
    },
  );
  return {
    name: typeof parsed.name === "string" ? parsed.name : undefined,
    dependsOnFramework,
  };
};

export const discoverProject = (root: string): Project => {
  const resolvedRoot = path.resolve(root);
  const nestedDir = path.join(resolvedRoot, "superwall");
  const superwallDir = fs.existsSync(nestedDir) ? nestedDir : resolvedRoot;

  const projectPackage = readProjectPackage(superwallDir);
  const marker: ProjectMarker | undefined = projectPackage?.dependsOnFramework
    ? "package.json"
    : undefined;

  const diagnostics: string[] = [];
  const surfaces: DiscoveredSurface[] = [];

  for (const kind of ["paywall", "funnel"] as const) {
    for (const id of listDirs(path.join(superwallDir, `${kind}s`))) {
      const surface = discoverSurface(
        kind,
        id,
        path.join(superwallDir, `${kind}s`, id),
        diagnostics,
      );
      if (surface) surfaces.push(surface);
    }
  }

  return {
    root: resolvedRoot,
    superwallDir,
    marker,
    packageName: projectPackage?.name,
    sharedMessages: discoverMessages(superwallDir),
    surfaces,
    diagnostics,
  };
};
