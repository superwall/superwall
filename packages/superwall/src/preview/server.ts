import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { createServer, searchForWorkspaceRoot, type Plugin, type ViteDevServer } from "vite";
import { loadSurfaceConfig } from "../config/load";
import { discoverProject, type DiscoveredSurface, type Project } from "../discover";
import { injectPlatformLayer, PLATFORM_STYLESHEET_URL, renderDocument } from "../document";
import { buildStudioProject } from "./project";
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

const projectModule = (project: Project): string => {
  const lazy = (file: string) =>
    `() => import(${JSON.stringify(moduleUrl(project.superwallDir, file))})`;
  const messageList = (messages: { locale: string; file: string }[]) =>
    `[${messages
      .map((entry) => `{ locale: ${JSON.stringify(entry.locale)}, load: ${lazy(entry.file)} }`)
      .join(", ")}]`;

  const surfaces = project.surfaces.map((surface) => {
    const pages = surface.pages
      .map((page) => `{ route: ${JSON.stringify(page.route)}, load: ${lazy(page.file)} }`)
      .join(", ");
    const fields = [
      `kind: ${JSON.stringify(surface.kind)}`,
      `id: ${JSON.stringify(surface.id)}`,
      `pages: [${pages}]`,
      `messages: ${messageList(surface.messages)}`,
      `loadConfig: ${lazy(surface.configFile)}`,
      surface.layoutFile ? `loadLayout: ${lazy(surface.layoutFile)}` : `loadLayout: undefined`,
    ];
    return `  { ${fields.join(", ")} }`;
  });

  return [
    `export const surfaces = [`,
    surfaces.join(",\n"),
    `]`,
    `export const sharedMessages = ${messageList(project.sharedMessages)}`,
    `export const diagnostics = ${JSON.stringify(project.diagnostics)}`,
  ].join("\n");
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

const PREVIEW_ROUTE = /^\/preview\/(paywall|funnel)\/([a-z0-9-]+)\/?$/;
const STUDIO_ROUTE = /^\/(paywall|funnel)\/[a-z0-9-]+\/?$/;
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
};

export type StudioActions = {
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

const STATUS_ROUTE = /^\/__studio\/status\/(paywall|funnel)\/([a-z0-9-]+)$/;

const previewPlugin = (
  projectRoot: string,
  platformStylesheet: string,
  studio?: StudioActions,
): Plugin => ({
  name: "superwall:preview",
  resolveId(id) {
    if (id === VIRTUAL_PROJECT_ID) return RESOLVED_VIRTUAL_PROJECT_ID;
    return undefined;
  },
  load(id) {
    if (id === RESOLVED_VIRTUAL_PROJECT_ID) {
      return projectModule(discoverProject(projectRoot));
    }
    return undefined;
  },
  configureServer(server) {
    const invalidate = (file: string) => {
      const relative = path.relative(projectRoot, file);
      if (relative.includes("paywalls") || relative.includes("funnels")) {
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
          buildStudioProject(projectRoot)
            .then((payload) => {
              json(res, { ...payload, capabilities: { actions: Boolean(studio) } });
            })
            .catch(next);
          return;
        }

        if (url === "/__studio/action" && req.method === "POST") {
          readBody(req)
            .then(async (body) => {
              const request = JSON.parse(body) as { action?: string; kind?: string; id?: string };
              const action = ACTION_NAMES.find((name) => name === request.action);
              const surface = discoverProject(projectRoot).surfaces.find(
                (candidate) => candidate.kind === request.kind && candidate.id === request.id,
              );
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
          const surface = discoverProject(projectRoot).surfaces.find(
            (candidate) => candidate.kind === status[1] && candidate.id === status[2],
          );
          if (!surface || !studio) {
            return json(res, {});
          }
          studio
            .status(surface)
            .then((value) => json(res, value))
            .catch(() => json(res, {}));
          return;
        }

        const preview = PREVIEW_ROUTE.exec(url);
        if (preview) {
          const project = discoverProject(projectRoot);
          const surface = project.surfaces.find(
            (candidate) => candidate.kind === preview[1] && candidate.id === preview[2],
          );
          if (!surface) {
            res.statusCode = 404;
            res.end(`No ${preview[1]} named "${preview[2]}"`);
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

        const isStudioRoute = url === "/" || STUDIO_ROUTE.test(url);
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
  projectRoot: string,
  options: PreviewServerOptions,
): Promise<ViteDevServer> => {
  const project = discoverProject(projectRoot);
  const server = await createServer({
    configFile: false,
    envFile: false,
    root: project.superwallDir,
    appType: "custom",
    logLevel: "warn",
    plugins: [
      react(),
      previewPlugin(
        project.root,
        options.platformStylesheet ?? PLATFORM_STYLESHEET_URL,
        options.studio,
      ),
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@": project.superwallDir,
      },
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "superwall > @superwall/runtime > @superwall/protocol > zod",
      ],
      exclude: ["superwall", "@superwall/runtime", "@superwall/protocol", "@superwall/studio"],
    },
    server: {
      port: options.port,
      strictPort: false,
      host: options.host ?? "0.0.0.0",
      fs: {
        allow: [project.root, frameworkDir, searchForWorkspaceRoot(project.superwallDir)],
      },
    },
  });
  await server.listen();
  return server;
};
