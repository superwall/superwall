import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { discoverProject, type DiscoveredSurface, type Project } from "../discover";

export type PreviewProject = { slug: string; root: string; project: Project };

export const slugFor = (root: string, taken: Set<string>): string => {
  const base =
    path
      .basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-") || "project";
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
};

export const readProjects = (
  roots: readonly string[],
  discover: (root: string) => Project = discoverProject,
): PreviewProject[] => {
  const taken = new Set<string>();
  return roots.map((root) => ({ slug: slugFor(root, taken), root, project: discover(root) }));
};

export type FoundSurface = { entry: PreviewProject; surface: DiscoveredSurface };

export const findSurface = (
  projects: readonly PreviewProject[],
  slug: string | undefined,
  kind: string,
  id: string,
): FoundSurface | undefined => {
  const scoped = slug ? projects.filter((entry) => entry.slug === slug) : projects;
  for (const entry of scoped) {
    const surface = entry.project.surfaces.find(
      (candidate) => candidate.kind === kind && candidate.id === id,
    );
    if (surface) return { entry, surface };
  }
  return undefined;
};

export const moduleUrl = (viteRoot: string, file: string): string => {
  const relative = path.relative(viteRoot, file);
  return relative.startsWith("..") ? `/@fs/${file}` : `/${relative.split(path.sep).join("/")}`;
};

export const projectModule = (projects: readonly PreviewProject[], viteRoot: string): string => {
  const lazy = (file: string) => `() => import(${JSON.stringify(moduleUrl(viteRoot, file))})`;
  const messageList = (messages: { locale: string; file: string }[]) =>
    `[${messages
      .map((entry) => `{ locale: ${JSON.stringify(entry.locale)}, load: ${lazy(entry.file)} }`)
      .join(", ")}]`;

  const surfaces = projects.flatMap(({ slug, project }) =>
    project.surfaces.map((surface) => {
      const routes = surface.routes
        .map((route) => `{ name: ${JSON.stringify(route.name)}, load: ${lazy(route.file)} }`)
        .join(", ");
      const fields = [
        `kind: ${JSON.stringify(surface.kind)}`,
        `id: ${JSON.stringify(surface.id)}`,
        `project: ${JSON.stringify(slug)}`,
        `routes: [${routes}]`,
        `messages: ${messageList(surface.messages)}`,
        `sharedMessages: ${messageList(project.sharedMessages)}`,
        `loadConfig: ${lazy(surface.configFile)}`,
        surface.layoutFile ? `loadLayout: ${lazy(surface.layoutFile)}` : `loadLayout: undefined`,
      ];
      return `  { ${fields.join(", ")} }`;
    }),
  );

  return [
    `export const surfaces = [`,
    surfaces.join(",\n"),
    `]`,
    `export const sharedMessages = ${messageList(projects[0]?.project.sharedMessages ?? [])}`,
    `export const diagnostics = ${JSON.stringify(projects.flatMap((one) => one.project.diagnostics))}`,
  ].join("\n");
};

const BUNDLED = new Set(["react", "react-dom", "superwall"]);

export const projectDependencies = (superwallDir: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(superwallDir, "package.json"), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null || !("dependencies" in parsed)) return [];
    const { dependencies } = parsed;
    if (typeof dependencies !== "object" || dependencies === null) return [];
    return Object.keys(dependencies).filter(
      (name) => !BUNDLED.has(name) && !name.startsWith("@superwall/"),
    );
  } catch {
    return [];
  }
};

const POSTCSS_CONFIG_FILES = [
  "postcss.config.js",
  "postcss.config.mjs",
  "postcss.config.cjs",
  "postcss.config.ts",
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
];

export const postcssSearchDir = (projects: readonly PreviewProject[]): string | undefined =>
  projects
    .flatMap((one) => [one.project.superwallDir, one.project.root])
    .find((dir) => POSTCSS_CONFIG_FILES.some((file) => fs.existsSync(path.join(dir, file))));

export const resolvableFrom = (dir: string): ((name: string) => boolean) => {
  const require = createRequire(path.join(dir, "package.json"));
  return (name) => {
    try {
      require.resolve(name);
      return true;
    } catch {
      return false;
    }
  };
};

export type ActionRequest = {
  action: string | undefined;
  project: string | undefined;
  kind: string;
  id: string;
};

const stringField = (value: unknown, key: string): string | undefined => {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const found = Reflect.get(value, key);
  return typeof found === "string" ? found : undefined;
};

export const readActionRequest = (body: string): ActionRequest => {
  const parsed: unknown = JSON.parse(body);
  return {
    action: stringField(parsed, "action"),
    project: stringField(parsed, "project"),
    kind: stringField(parsed, "kind") ?? "",
    id: stringField(parsed, "id") ?? "",
  };
};
