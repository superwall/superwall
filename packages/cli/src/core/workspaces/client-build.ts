import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleDir, MANIFEST_FILE, WorkspaceError } from "./project";
import { CLIENT_BUNDLE_MODULE } from "./wire";

interface ClientBuildInput {
  path: string;
  bytes: number;
}

type ClientBuildResult =
  | { ok: true; module: string; scriptBytes: number; styleBytes: number; inputs: readonly ClientBuildInput[] }
  | { ok: false; message: string };

interface ClientBuildModule {
  buildClient(esbuild: unknown, input: { root: string; entry: string }): Promise<ClientBuildResult>;
}

interface ConstantsModule {
  CLIENT_BUNDLE_MODULE: string;
  CLIENT_BUNDLE_MAX_BYTES: number;
}

const ENTRY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._\-/]*\.(?:tsx|ts|jsx|js|mts|mjs)$/;
const ENTRY_MAX_LENGTH = 256;
const LARGEST_SHOWN = 5;

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export function clientEntryProblem(entry: unknown): string | undefined {
  if (typeof entry !== "string" || entry.length > ENTRY_MAX_LENGTH || !ENTRY_PATTERN.test(entry)) {
    return `${MANIFEST_FILE}: client.entry must be a path inside the repo to a .ts, .tsx, .js, .jsx, .mts or .mjs file`;
  }
  const segments = entry.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return `${MANIFEST_FILE}: client.entry must stay inside the repo`;
  }
  if (segments.includes("node_modules")) return `${MANIFEST_FILE}: client.entry must not be inside node_modules`;
  return undefined;
}

function entryProblem(root: string, entry: string): string | undefined {
  const file = path.join(root, entry);
  try {
    if (!fs.lstatSync(file).isFile()) return `client.entry: ${entry} is not a file.`;
    if (!fs.realpathSync(file).startsWith(`${root}${path.sep}`)) return `client.entry: ${entry} is outside the repo.`;
    return undefined;
  } catch {
    return `client.entry: ${entry} is not in the repo.`;
  }
}

async function loadSdk(root: string): Promise<ClientBuildModule & ConstantsModule> {
  const project = createRequire(path.join(root, "package.json"));
  try {
    const [build, constants] = await Promise.all([
      import(pathToFileURL(project.resolve("@superwall/workspace-sdk/client-build")).href) as Promise<ClientBuildModule>,
      import(pathToFileURL(project.resolve("@superwall/workspace-sdk/constants")).href) as Promise<ConstantsModule>,
    ]);
    return { ...build, ...constants };
  } catch {
    throw new WorkspaceError(
      "A workspace with client.entry needs workspace SDK 0.2.0 or newer. Run `superwall workspaces update`, then `npm install`.",
    );
  }
}

function loadEsbuild(wranglerPackage: string): unknown {
  try {
    return createRequire(wranglerPackage)("esbuild");
  } catch {
    throw new WorkspaceError(
      "client.entry is bundled with the esbuild this project's wrangler brings, and it isn't installed. Run `npm install`.",
    );
  }
}

export function explainBundleFailure(error: Error, hasClient: boolean): Error {
  if (hasClient || !error.message.includes(CLIENT_BUNDLE_MODULE)) return error;
  return new WorkspaceError(
    `${error.message}\nDeclare the browser entry in ${MANIFEST_FILE}: "client": { "entry": "src/client.tsx" }.`,
  );
}

export async function buildClientAlias(projectRoot: string, entry: unknown, wranglerPackage: string): Promise<readonly string[]> {
  const problem = clientEntryProblem(entry);
  if (problem !== undefined) throw new WorkspaceError(problem);
  const root = fs.realpathSync(projectRoot);
  const relative = entry as string;
  const missing = entryProblem(root, relative);
  if (missing !== undefined) throw new WorkspaceError(missing);

  const sdk = await loadSdk(root);
  const esbuild = loadEsbuild(wranglerPackage);
  let result: ClientBuildResult;
  try {
    result = await sdk.buildClient(esbuild, { root, entry: relative });
  } catch (error) {
    throw new WorkspaceError(
      `${(error as Error).message} It comes with this project's wrangler, so install the wrangler the starter pins.`,
    );
  }
  if (!result.ok) throw new WorkspaceError(result.message);

  const total = result.scriptBytes + result.styleBytes;
  if (total > sdk.CLIENT_BUNDLE_MAX_BYTES) {
    const largest = result.inputs
      .slice(0, LARGEST_SHOWN)
      .map((input) => `${input.path} (${megabytes(input.bytes)})`)
      .join(", ");
    throw new WorkspaceError(
      `The client bundle is ${total} bytes (${megabytes(total)}); the limit is ${sdk.CLIENT_BUNDLE_MAX_BYTES} (${megabytes(sdk.CLIENT_BUNDLE_MAX_BYTES)}). Largest: ${largest}.`,
    );
  }
  const dir = bundleDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "client-bundle.mjs");
  fs.writeFileSync(file, result.module);
  return ["--alias", `${sdk.CLIENT_BUNDLE_MODULE}:${file}`];
}
