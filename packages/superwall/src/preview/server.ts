import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { createServer, searchForWorkspaceRoot, type Plugin, type ViteDevServer } from "vite";
import { loadSurfaceConfig } from "../config/load";
import { discoverProject, type DiscoveredSurface, type Project } from "../discover";
import { injectPlatformLayer, PLATFORM_STYLESHEET_URL, renderDocument } from "../document";
import { EXTRA_ASSET_TYPES } from "../build";
import { readLock } from "../lock";
import { attachIdentifiers, attachProducts, buildDeviceManifest } from "./device";
import { buildStudioProjects } from "./project";

export { buildStudioProject } from "./project";
import { injectWebviewSimulation } from "./webview";

const VIRTUAL_PROJECT_ID = "virtual:superwall/project";
const RESOLVED_VIRTUAL_PROJECT_ID = "\0" + VIRTUAL_PROJECT_ID;

const previewMount = fileURLToPath(new URL("./mount.tsx", import.meta.url));
const frameworkDir = fileURLToPath(new URL("../../", import.meta.url));

const studioDistDir = (): string | undefined => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("@superwall/studio/package.json");
    const dist = path.join(path.dirname(pkg), "dist");
    return fs.existsSync(path.join(dist, "index.html")) ? dist : undefined;
  } catch {
    return undefined;
  }
};

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const moduleUrl = (viteRoot: string, file: string): string => {
  const relative = path.relative(viteRoot, file);
  return relative.startsWith("..") ? `/@fs/${file}` : `/${relative.split(path.sep).join("/")}`;
};

export type PreviewProject = { slug: string; root: string; project: Project };

const slugFor = (root: string, taken: Set<string>): string => {
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

const readProjects = (roots: readonly string[]): PreviewProject[] => {
  const taken = new Set<string>();
  return roots.map((root) => ({
    slug: slugFor(root, taken),
    root,
    project: discoverProject(root),
  }));
};

const findSurface = (
  projects: readonly PreviewProject[],
  slug: string | undefined,
  kind: string,
  id: string,
) => {
  const scoped = slug ? projects.filter((entry) => entry.slug === slug) : projects;
  for (const entry of scoped) {
    const surface = entry.project.surfaces.find(
      (candidate) => candidate.kind === kind && candidate.id === id,
    );
    if (surface) return { entry, surface };
  }
  return undefined;
};

const projectModule = (projects: readonly PreviewProject[], viteRoot: string): string => {
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

const projectDependencies = (superwallDir: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(superwallDir, "package.json"), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return [];
    const deps = (parsed as { dependencies?: Record<string, string> }).dependencies ?? {};
    return Object.keys(deps).filter(
      (name) =>
        name !== "react" &&
        name !== "react-dom" &&
        !name.startsWith("@superwall/") &&
        name !== "superwall",
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

const postcssSearchDir = (projects: readonly PreviewProject[]): string | undefined =>
  projects
    .flatMap((one) => [one.project.superwallDir, one.project.root])
    .find((dir) => POSTCSS_CONFIG_FILES.some((file) => fs.existsSync(path.join(dir, file))));

const resolvableFrom = (dir: string): ((name: string) => boolean) => {
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

const previewDocument = async (
  surface: DiscoveredSurface,
  platformStylesheet: string,
): Promise<string> => {
  const { config } = await loadSurfaceConfig(surface);
  const document = renderDocument({
    title: `${surface.id} — superwall`,
    config,
    entry: `/@fs/${previewMount}`,
  });
  return injectWebviewSimulation(injectPlatformLayer(document, platformStylesheet));
};

const PREVIEW_ROUTE = /^\/preview\/(?:([a-z0-9-]+)\/)?(paywall|funnel)\/([a-z0-9-]+)\/?$/;
const STUDIO_ROUTE = /^\/(?:[a-z0-9-]+\/)?(paywall|funnel)\/[a-z0-9-]+\/?$/;
const STUDIO_ASSET_PREFIX = "/__studio/";

const STUDIO_MISSING = `superwall studio is not built.

Run: bun run --filter '@superwall/studio' build
(or reinstall — the workspace postinstall builds it)`;

export type StudioActionName = "push" | "promote" | "publish";

export type StudioActionResult =
  | { ok: true; version: number; live: boolean }
  | { ok: false; error: string };

export type StudioActionProgress = (step: string, state: "start" | "done") => void;

export type StudioStatus = {
  paywallId?: string;
  liveUrl?: string;
  active?: boolean;
  updatedAt?: string;
  unreachable?: string;
  identifier?: string;
};

export type Samples = {
  device?: Record<string, unknown>;
  user?: Record<string, unknown>;
  products?: Record<string, Record<string, unknown>>;
  live?: { device: boolean; user: boolean };
  unreachable?: string;
};

export type AppScheme = {
  scheme?: string;
  source?: "dashboard" | "app";
  blocksLocalNetworking?: string;
};

export type StudioActions = {
  appScheme?(): Promise<AppScheme>;
  samples?(): Promise<Samples>;
  run(
    action: StudioActionName,
    surface: DiscoveredSurface,
    onProgress?: StudioActionProgress,
  ): Promise<StudioActionResult>;
  status(surface: DiscoveredSurface): Promise<StudioStatus>;
};

const ACTION_NAMES: readonly StudioActionName[] = ["push", "promote", "publish"];

const readBody = (req: NodeJS.ReadableStream): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const json = (
  res: { setHeader(n: string, v: string): void; end(b: string): void },
  value: unknown,
) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
};

let identifierCache: Record<string, string> = {};
let identifierRefreshAt = 0;
let identifierRefresh: Promise<void> | undefined;

const refreshIdentifiers = (
  entries: readonly PreviewProject[],
  studio: StudioActions | undefined,
): void => {
  if (!studio) return;
  if (identifierRefresh !== undefined) return;
  if (Date.now() - identifierRefreshAt < 60_000) return;
  identifierRefreshAt = Date.now();
  identifierRefresh = (async () => {
    const byPaywallId: Record<string, string> = {};
    for (const entry of entries) {
      for (const surface of entry.project.surfaces) {
        const status = await studio.status(surface).catch(() => undefined);
        if (status?.identifier !== undefined && status.paywallId !== undefined) {
          byPaywallId[status.paywallId] = status.identifier;
        }
      }
    }
    identifierCache = byPaywallId;
  })().finally(() => {
    identifierRefresh = undefined;
  });
};

const STATUS_ROUTE = /^\/__studio\/status\/(?:([a-z0-9-]+)\/)?(paywall|funnel)\/([a-z0-9-]+)$/;

const previewPlugin = (
  roots: readonly string[],
  viteRoot: string,
  platformStylesheet: string,
  studio: StudioActions | undefined,
  appScheme: Promise<AppScheme | undefined>,
): Plugin => ({
  name: "superwall:preview",
  resolveId(id) {
    if (id === VIRTUAL_PROJECT_ID) return RESOLVED_VIRTUAL_PROJECT_ID;
    return undefined;
  },
  load(id) {
    if (id === RESOLVED_VIRTUAL_PROJECT_ID) {
      return projectModule(readProjects(roots), viteRoot);
    }
    return undefined;
  },
  configureServer(server) {
    const invalidate = (file: string) => {
      if (roots.some((root) => path.relative(root, file).includes("paywalls"))) {
        const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_PROJECT_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      }
    };
    server.watcher.on("add", invalidate);
    server.watcher.on("unlink", invalidate);
    server.watcher.on("addDir", invalidate);
    server.watcher.on("unlinkDir", invalidate);

    return () => {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "/").split("?")[0];

        if (url === "/__studio/project.json") {
          Promise.all([buildStudioProjects(readProjects(roots)), appScheme])
            .then(([payload, scheme]) => {
              json(res, {
                ...payload,
                capabilities: { actions: Boolean(studio) },
                ...(scheme?.scheme === undefined ? {} : { scheme: scheme.scheme }),
              });
            })
            .catch(next);
          return;
        }

        if (url === "/__studio/samples.json") {
          const sample = studio?.samples?.();
          if (!sample) {
            json(res, {});
            return;
          }
          sample
            .then((value) => json(res, value))
            .catch((error: unknown) =>
              json(res, { unreachable: error instanceof Error ? error.message : String(error) }),
            );
          return;
        }

        if (url === "/__studio/action" && req.method === "POST") {
          readBody(req)
            .then(async (body) => {
              const request = JSON.parse(body) as {
                action?: string;
                kind?: string;
                id?: string;
                project?: string;
              };
              const action = ACTION_NAMES.find((name) => name === request.action);
              const surface = findSurface(
                readProjects(roots),
                request.project,
                request.kind ?? "",
                request.id ?? "",
              )?.surface;
              res.setHeader("Content-Type", "application/x-ndjson");
              res.setHeader("Cache-Control", "no-store");
              const line = (value: unknown) => res.write(`${JSON.stringify(value)}\n`);

              if (!action || !surface) {
                line({ result: { ok: false, error: "Unknown action or paywall." } });
              } else if (!studio) {
                line({ result: { ok: false, error: "Actions need `superwall dev`." } });
              } else {
                const result = await studio.run(action, surface, (step, state) =>
                  line({ step, state }),
                );
                line({ result });
              }
              res.end();
            })
            .catch((error: unknown) => {
              json(res, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          return;
        }

        const status = STATUS_ROUTE.exec(url);
        if (status) {
          const surface = findSurface(
            readProjects(roots),
            status[1] || undefined,
            status[2] ?? "",
            status[3] ?? "",
          )?.surface;
          if (!surface || !studio) {
            return json(res, {});
          }
          studio
            .status(surface)
            .then((value) => json(res, value))
            .catch((error: unknown) =>
              json(res, { unreachable: error instanceof Error ? error.message : String(error) }),
            );
          return;
        }

        if (url === "/device/manifest.json") {
          const entries = readProjects(roots);
          const manifest = buildDeviceManifest(
            entries.map((entry) => ({
              slug: entry.slug,
              surfaces: entry.project.surfaces,
              lock: readLock(entry.project.superwallDir),
            })),
          );
          refreshIdentifiers(entries, studio);
          buildStudioProjects(entries)
            .then((payload) => {
              const products = Object.fromEntries(
                payload.surfaces.map((surface) => [
                  `${surface.kind}/${surface.id}`,
                  surface.products,
                ]),
              );
              json(res, attachProducts(attachIdentifiers(manifest, identifierCache), products));
            })
            .catch(next);
          return;
        }

        const preview = PREVIEW_ROUTE.exec(url);
        if (preview) {
          const surface = findSurface(
            readProjects(roots),
            preview[1] || undefined,
            preview[2] ?? "",
            preview[3] ?? "",
          )?.surface;
          if (!surface) {
            res.statusCode = 404;
            res.end(`No ${preview[2]} named "${preview[3]}"`);
            return;
          }
          previewDocument(surface, platformStylesheet)
            .then((document) => server.transformIndexHtml(url, document))
            .then((html) => {
              res.setHeader("Content-Type", "text/html");
              res.end(html);
            })
            .catch(next);
          return;
        }

        const isStudioRoute =
          url === "/" || url === "/device" || url === "/device/" || STUDIO_ROUTE.test(url);
        const isStudioAsset = url.startsWith(STUDIO_ASSET_PREFIX);
        if (!isStudioRoute && !isStudioAsset) {
          next();
          return;
        }

        const dist = studioDistDir();
        if (!dist) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(STUDIO_MISSING);
          return;
        }

        const file = isStudioAsset
          ? path.join(dist, url.slice(STUDIO_ASSET_PREFIX.length))
          : path.join(dist, "index.html");
        if (!path.resolve(file).startsWith(path.resolve(dist)) || !fs.existsSync(file)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        res.setHeader(
          "Content-Type",
          STATIC_TYPES[path.extname(file)] ?? "application/octet-stream",
        );
        res.end(fs.readFileSync(file));
      });
    };
  },
});

export type PreviewServerOptions = {
  port: number;
  host?: string;
  platformStylesheet?: string;
  studio?: StudioActions;
};

export const startPreviewServer = async (
  projectRoots: string | readonly string[],
  options: PreviewServerOptions,
): Promise<ViteDevServer> => {
  const roots = (typeof projectRoots === "string" ? [projectRoots] : [...projectRoots]).map(
    (root) => path.resolve(root),
  );
  const projects = readProjects(roots);
  const first = projects[0];
  if (!first) throw new Error("startPreviewServer needs at least one project directory.");

  const appScheme = Promise.resolve(options.studio?.appScheme?.()).catch(() => undefined);
  refreshIdentifiers(projects, options.studio);

  const viteRoot = first.project.superwallDir;
  const postcss = postcssSearchDir(projects);
  const resolvable = resolvableFrom(viteRoot);

  const server = await createServer({
    configFile: false,
    envFile: false,
    root: viteRoot,
    appType: "custom",
    logLevel: "warn",
    ...(postcss === undefined ? {} : { css: { postcss } }),
    assetsInclude: EXTRA_ASSET_TYPES.map((extension) => `**/*.${extension}`),
    plugins: [
      react(),
      previewPlugin(
        projects.map((one) => one.project.root),
        viteRoot,
        options.platformStylesheet ?? PLATFORM_STYLESHEET_URL,
        options.studio,
        appScheme,
      ),
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@": first.project.superwallDir,
      },
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "superwall > @superwall/runtime > @superwall/protocol > zod",
        ...projects
          .flatMap((one) => projectDependencies(one.project.superwallDir))
          .filter(resolvable),
      ],
      exclude: ["superwall", "@superwall/runtime", "@superwall/protocol", "@superwall/studio"],
    },
    server: {
      port: options.port,
      strictPort: false,
      host: options.host ?? "0.0.0.0",
      fs: {
        allow: [
          ...projects.map((one) => one.project.root),
          frameworkDir,
          searchForWorkspaceRoot(first.project.superwallDir),
        ],
      },
    },
  });
  await server.listen();
  return server;
};
