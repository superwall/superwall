import * as fs from "node:fs";
import * as path from "node:path";

export type DiscoveredRoute = {
  name: string;
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
  routes: DiscoveredRoute[];
  messages: DiscoveredMessages[];
  diagnostics: string[];
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

const ROUTE_SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
const INITIAL_ROUTE = "index";
const LAYOUT_FILE = "layout.tsx";

const byName = (a: fs.Dirent, b: fs.Dirent): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

const DEFAULT_EXPORT = /(?:^|[\s;})])export\s+default[\s({[]/;
const DEFAULT_SPECIFIER = /export\s*\{[^}]*\bdefault\b[^}]*\}/;

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const hasDefaultExport = (file: string): boolean => {
  let source: string;
  try {
    source = withoutComments(fs.readFileSync(file, "utf8"));
  } catch {
    return true;
  }
  return DEFAULT_EXPORT.test(source) || DEFAULT_SPECIFIER.test(source);
};

type Stray = { at: string; reason: string };

const strayReport = (label: string, strays: readonly Stray[]): string => {
  const width = Math.max(...strays.map((stray) => stray.at.length));
  const one = strays.length === 1;
  const it = one ? "it" : "them";
  const components = strays.every((stray) => stray.at.endsWith(".tsx"));
  return [
    `${label}: ${one ? "1 file in app/ is not a route" : `${strays.length} files in app/ are not routes`}, so ${one ? "it was" : "they were"} skipped:`,
    ...strays.map((stray) => `  ${stray.at.padEnd(width)}  ${stray.reason}`),
    "",
    components
      ? `Move ${it} to components/ — app/ holds routes, layout.tsx, and stylesheets.`
      : `Move ${it} out of app/ — it holds routes, layout.tsx, and stylesheets.`,
  ].join("\n");
};

const discoverRoutes = (appDir: string, strays: Stray[], prefix = ""): DiscoveredRoute[] => {
  if (!fs.existsSync(appDir)) return [];
  const routes: DiscoveredRoute[] = [];

  for (const entry of fs.readdirSync(appDir, { withFileTypes: true }).toSorted(byName)) {
    if (entry.name.startsWith(".")) continue;
    const at = `${prefix}${entry.name}`;

    if (entry.isDirectory()) {
      if (!ROUTE_SEGMENT.test(entry.name)) {
        strays.push({ at: `${at}/`, reason: "not lowercase kebab-case" });
        continue;
      }
      routes.push(...discoverRoutes(path.join(appDir, entry.name), strays, `${at}/`));
      continue;
    }

    if (prefix === "" && entry.name === LAYOUT_FILE) continue;
    if (entry.name.endsWith(".css")) continue;

    if (!entry.name.endsWith(".tsx")) {
      strays.push({ at, reason: "not a .tsx file" });
      continue;
    }

    const base = entry.name.slice(0, -".tsx".length);
    if (!ROUTE_SEGMENT.test(base)) {
      strays.push({ at, reason: "not lowercase kebab-case" });
      continue;
    }

    const file = path.join(appDir, entry.name);
    if (!hasDefaultExport(file)) {
      strays.push({ at, reason: "no default export" });
      continue;
    }

    const name = base === INITIAL_ROUTE ? prefix.replace(/\/$/, "") : `${prefix}${base}`;
    routes.push({
      name: name === "" ? INITIAL_ROUTE : name,
      file,
    });
  }

  return routes;
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
  const label = `${kind}s/${id}`;
  const own: string[] = [];
  const strays: Stray[] = [];
  const found = discoverRoutes(path.join(dir, "app"), strays).toSorted((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  if (strays.length > 0) own.push(strayReport(label, strays));

  const routes: DiscoveredRoute[] = [];
  const claimed = new Map<string, string>();
  const appDir = path.join(dir, "app");
  for (const route of found) {
    const owner = claimed.get(route.name);
    if (owner) {
      const rel = (file: string) => `app/${path.relative(appDir, file).split(path.sep).join("/")}`;
      own.push(
        `${label}: ${rel(owner)} and ${rel(route.file)} are both the route "${route.name}" — keep one`,
      );
      continue;
    }
    claimed.set(route.name, route.file);
    routes.push(route);
  }
  if (!routes.some((route) => route.name === INITIAL_ROUTE)) {
    diagnostics.push(...own, `${label}: missing app/index.tsx — every ${kind} starts at "index"`);
    return undefined;
  }
  const layoutFile = fileIfExists(path.join(dir, "app", LAYOUT_FILE));
  const configFile = fileIfExists(path.join(dir, "config.ts"));
  if (!configFile) {
    diagnostics.push(...own, `${label} has no config.ts — every ${kind} needs one (definePaywall)`);
    return undefined;
  }
  diagnostics.push(...own);
  return {
    kind,
    id,
    dir,
    configFile,
    layoutFile,
    routes,
    messages: discoverMessages(dir),
    diagnostics: own,
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

export { loadSurfaceConfig } from "./config/load";
