import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Filesystem discovery. Identity is the path — no name fields, no
 * registration.
 *
 * A project keeps everything Superwall-related in a `superwall/` directory at
 * the repo root (or the project root IS that directory — both work):
 *
 * ```
 * superwall/
 * ├── config.ts            app-level defaults (optional)
 * ├── components/          shared design system
 * ├── messages/<locale>.ts shared strings, inherited by every surface
 * ├── assets/              shared images/fonts
 * ├── paywalls/<id>/       each one a mini React app
 * │   ├── config.ts
 * │   ├── app/page.tsx     file-based routing, Next.js-style
 * │   ├── app/<route>/page.tsx
 * │   ├── app/layout.tsx   optional shared chrome
 * │   ├── components/
 * │   └── messages/<locale>.ts
 * └── funnels/<id>/        same shape — onboarding, web2app, win-back flows
 * ```
 */

export type DiscoveredPage = {
  /** "/" for app/page.tsx, "/offer" for app/offer/page.tsx, … */
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
  configFile?: string;
  layoutFile?: string;
  pages: DiscoveredPage[];
  messages: DiscoveredMessages[];
};

export type Project = {
  root: string;
  /** The superwall/ directory (may equal root for dedicated repos). */
  superwallDir: string;
  appConfigFile?: string;
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
  return {
    kind,
    id,
    dir,
    configFile: fileIfExists(path.join(dir, "config.ts")),
    layoutFile: fileIfExists(path.join(dir, "app/layout.tsx")),
    pages,
    messages: discoverMessages(dir),
  };
};

/**
 * Reads the `superwall/` directory conventions into a project: surfaces,
 * their pages and message catalogs, and any layout diagnostics.
 */
export const discoverProject = (root: string): Project => {
  const resolvedRoot = path.resolve(root);
  // superwall/ at the repo root, or the root itself for dedicated repos.
  const nestedDir = path.join(resolvedRoot, "superwall");
  const superwallDir = fs.existsSync(nestedDir) ? nestedDir : resolvedRoot;

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
    appConfigFile: fileIfExists(path.join(superwallDir, "config.ts")),
    sharedMessages: discoverMessages(superwallDir),
    surfaces,
    diagnostics,
  };
};
