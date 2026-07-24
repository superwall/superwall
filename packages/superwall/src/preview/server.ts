import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { createServer, defaultClientConditions, type Plugin, type ViteDevServer } from "vite";
import { loadSurfaceConfig } from "../config/load";
import { discoverProject, type DiscoveredSurface, type Project } from "../discover";
import { injectPlatformLayer, PLATFORM_STYLESHEET_URL, renderDocument } from "../document";
import { buildStudioProject } from "./project";
import { injectWebviewSimulation } from "./webview";

const VIRTUAL_PROJECT_ID = "virtual:superwall/project";
const RESOLVED_VIRTUAL_PROJECT_ID = "\0" + VIRTUAL_PROJECT_ID;

const previewMount = fileURLToPath(new URL("./mount.tsx", import.meta.url));

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

const moduleUrl = (projectRoot: string, file: string): string => {
  const relative = path.relative(projectRoot, file);
  return relative.startsWith("..") ? `/@fs/${file}` : `/${relative.split(path.sep).join("/")}`;
};

const projectModule = (project: Project): string => {
  const lazy = (file: string) => `() => import(${JSON.stringify(moduleUrl(project.root, file))})`;
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
      surface.configFile
        ? `loadConfig: ${lazy(surface.configFile)}`
        : `loadConfig: () => Promise.resolve({ default: undefined })`,
      surface.layoutFile ? `loadLayout: ${lazy(surface.layoutFile)}` : `loadLayout: undefined`,
    ];
    return `  { ${fields.join(", ")} }`;
  });

  return [
    `export const surfaces = [`,
    surfaces.join(",\n"),
    `]`,
    `export const loadAppConfig = ${
      project.appConfigFile
        ? lazy(project.appConfigFile)
        : `() => Promise.resolve({ default: undefined })`
    }`,
    `export const sharedMessages = ${messageList(project.sharedMessages)}`,
    `export const diagnostics = ${JSON.stringify(project.diagnostics)}`,
  ].join("\n");
};

const previewDocument = async (
  project: Project,
  surface: DiscoveredSurface,
  platformStylesheet: string,
): Promise<string> => {
  const { config } = await loadSurfaceConfig(project, surface);
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

const previewPlugin = (projectRoot: string, platformStylesheet: string): Plugin => ({
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
      // Surface/page add/remove/rename changes the discovered graph.
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

    // After Vite's internal middlewares: the studio (built app) owns `/`,
    // `/<kind>/<id>`, and `/__studio/*`; bare surface mounts live at
    // `/preview/<kind>/<id>` inside the project's vite graph.
    return () => {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "/").split("?")[0];

        if (url === "/__studio/project.json") {
          buildStudioProject(projectRoot)
            .then((payload) => {
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              res.end(JSON.stringify(payload));
            })
            .catch(next);
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
          previewDocument(project, surface, platformStylesheet)
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
  /**
   * The platform stylesheet previews are served under. Defaults to the
   * production live.css, so previews match what Superwall serves without
   * any configuration.
   */
  platformStylesheet?: string;
};

/**
 * Starts the server behind `superwall dev`: the built studio, the project
 * payload it renders from, and the surface previews its device frames
 * iframe — each served the way the runtime serves a published snapshot.
 * Falls back to the next free port.
 */
export const startPreviewServer = async (
  projectRoot: string,
  options: PreviewServerOptions,
): Promise<ViteDevServer> => {
  const project = discoverProject(projectRoot);
  const server = await createServer({
    configFile: false,
    envFile: false,
    root: project.root,
    appType: "custom",
    plugins: [
      react(),
      previewPlugin(project.root, options.platformStylesheet ?? PLATFORM_STYLESHEET_URL),
    ],
    resolve: {
      // Workspace packages resolve to TypeScript sources; one React copy.
      conditions: ["superwall-ts", ...defaultClientConditions],
      dedupe: ["react", "react-dom"],
      alias: {
        // "@/…" points at the superwall/ directory, Next.js-style.
        "@": project.superwallDir,
      },
    },
    optimizeDeps: {
      // zod is reached through source-resolved workspace packages (excluded
      // below), so vite can't see it statically — declaring it prevents a
      // mid-session re-optimization reload on first load. The `superwall > `
      // prefix resolves it through the framework package (isolated installs
      // keep it out of the project's own node_modules).
      include: ["react", "react-dom", "react-dom/client", "superwall > zod"],
      exclude: ["superwall", "@superwall/runtime", "@superwall/protocol", "@superwall/studio"],
    },
    server: {
      port: options.port,
      // Fall back to the next free port instead of failing — the command
      // reports the resolved URL.
      strictPort: false,
      host: options.host ?? "0.0.0.0",
    },
  });
  await server.listen();
  return server;
};
