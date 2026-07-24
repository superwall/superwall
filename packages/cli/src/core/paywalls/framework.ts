import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface FrameworkPage {
  route: string;
  file: string;
}

export interface FrameworkSurface {
  kind: "paywall" | "funnel";
  id: string;
  dir: string;
  configFile?: string;
  pages: FrameworkPage[];
}

export interface FrameworkProject {
  root: string;
  superwallDir: string;
  appConfigFile?: string;
  surfaces: FrameworkSurface[];
  diagnostics: string[];
}

export interface SurfaceBuild {
  snapshotId: string;
  html: string;
  bytes: number;
  htmlFile: string;
}

export interface PreviewServerHandle {
  resolvedUrls?: { local: string[] } | null;
}

export interface Framework {
  discoverProject(root: string): FrameworkProject;
  buildSurface(project: FrameworkProject, surface: FrameworkSurface): Promise<SurfaceBuild>;
  startPreviewServer(
    root: string,
    options: { port: number; host?: string; platformStylesheet?: string },
  ): Promise<PreviewServerHandle>;
}

export class FrameworkNotFoundError extends Error {
  constructor(dir: string) {
    super(
      `No superwall framework found from ${dir}.\n` +
        "Install it in the project (`npm i superwall` / `bun add superwall`) " +
        "and make sure you run this inside a project with a superwall/ directory.",
    );
  }
}

async function importSubpath(packageDir: string, subpath: string): Promise<unknown> {
  const require = createRequire(join(packageDir, "package.json"));
  return import(pathToFileURL(require.resolve(subpath)).href);
}

function fn<T>(mod: unknown, name: string, subpath: string): T {
  if (typeof mod !== "object" || mod === null) {
    throw new Error(`superwall ${subpath} did not load as a module`);
  }
  const candidate = (mod as Record<string, unknown>)[name];
  if (typeof candidate !== "function") {
    throw new Error(
      `This project's superwall version does not export ${name} from ${subpath} — ` +
        "update the project's superwall dependency.",
    );
  }
  return candidate as T;
}

export function resolveFrameworkDir(cwd: string): string {
  try {
    const require = createRequire(join(cwd, "package.json"));
    const packageJson = require.resolve("superwall/package.json");
    return join(packageJson, "..");
  } catch {
    throw new FrameworkNotFoundError(cwd);
  }
}

export async function loadFramework(cwd: string): Promise<Framework> {
  const dir = resolveFrameworkDir(cwd);

  const [discover, build, preview] = await Promise.all([
    importSubpath(dir, "superwall/discover"),
    importSubpath(dir, "superwall/build"),
    importSubpath(dir, "superwall/preview"),
  ]);

  return {
    discoverProject: fn(discover, "discoverProject", "superwall/discover"),
    buildSurface: fn(build, "buildSurface", "superwall/build"),
    startPreviewServer: fn(preview, "startPreviewServer", "superwall/preview"),
  };
}
