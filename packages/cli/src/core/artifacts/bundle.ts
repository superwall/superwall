import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { buildClientAlias, explainBundleFailure } from "./client-build";
import { bundleDir, readManifest, ArtifactError } from "./project";
import { BUNDLE_MAX_BYTES } from "./wire";
import { assertBuilderAccepts, outsideRepoProblem, workerInputsOutside } from "./wrangler-config";

const run = promisify(execFile);

export interface BundleCompatibility {
  date: string;
  flags: readonly string[];
}

export interface BuiltBundle {
  module: string;
  bytes: number;
  compatibility: BundleCompatibility;
}

export type ReadConfig = (root: string) => Promise<{ config?: unknown; error?: string }>;

export interface RunWrangler {
  (root: string, args: readonly string[]): Promise<void>;
  readConfig?: ReadConfig;
}

export function resolveWranglerPackage(root: string): string {
  try {
    return createRequire(path.join(root, "package.json")).resolve("wrangler/package.json");
  } catch {
    throw new ArtifactError(
      "This artifact needs wrangler installed to bundle it. Run `npm install`, or `npm install -D wrangler` if it isn't in package.json.",
    );
  }
}

const PASSED_ENV = ["PATH", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP", "SystemRoot"];

const builderEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(PASSED_ENV.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]])),
  LANG: "C.UTF-8",
  CI: "1",
  NO_COLOR: "1",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_SEND_ERROR_REPORTS: "false",
});

const runWrangler: RunWrangler = async (root, args) => {
  const bin = path.join(path.dirname(resolveWranglerPackage(root)), "bin", "wrangler.js");
  try {
    await run("node", [bin, ...args], {
      cwd: root,
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
      env: builderEnv(),
    });
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    const output = `${stdout}\n${stderr}`.trim().split("\n").slice(-30).join("\n");
    throw new ArtifactError(`The artifact didn't bundle:\n${output}`);
  }
};

const READ_CONFIG_SCRIPT = `
import { writeFileSync } from "node:fs";
const [wrangler, out] = process.argv.slice(1);
const { unstable_readConfig } = await import(wrangler);
let result;
try {
  const config = unstable_readConfig({}, { hideWarnings: true });
  result = config.configPath ? { config } : { config: null };
} catch (error) {
  result = { error: error instanceof Error ? error.message : String(error) };
}
writeFileSync(out, JSON.stringify(result));
`;

const readWranglerConfig: ReadConfig = async (root) => {
  resolveWranglerPackage(root);
  const wrangler = pathToFileURL(createRequire(path.join(root, "package.json")).resolve("wrangler")).href;
  const out = path.join(bundleDir(root), "config.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(out, { force: true });
  await run("node", ["--input-type=module", "-e", READ_CONFIG_SCRIPT, wrangler, out], {
    cwd: root,
    timeout: 120_000,
    env: builderEnv(),
  }).catch(() => undefined);
  try {
    return JSON.parse(fs.readFileSync(out, "utf8")) as { config?: unknown; error?: string };
  } catch {
    return { error: "wrangler couldn't read it." };
  }
};

async function acceptedConfig(
  root: string,
  read: ReadConfig,
): Promise<{ configPath: string; compatibility: BundleCompatibility; tsconfig: boolean }> {
  const { config, error } = await read(root);
  if (error !== undefined) throw new ArtifactError(`The wrangler config could not be read: ${error}`);
  assertBuilderAccepts(config);
  const accepted = config as {
    configPath: unknown;
    compatibility_date: string;
    compatibility_flags?: readonly string[];
    tsconfig?: unknown;
  };
  const configPath = String(accepted.configPath);
  if (path.dirname(fs.realpathSync(path.resolve(root, configPath))) !== fs.realpathSync(root)) {
    throw new ArtifactError("This would fail on the builder. No wrangler config was read from the repo root.");
  }
  return {
    configPath,
    compatibility: { date: accepted.compatibility_date, flags: accepted.compatibility_flags ?? [] },
    tsconfig: typeof accepted.tsconfig === "string" && accepted.tsconfig !== "",
  };
}

function assertInputsInRepo(root: string, meta: { inputs?: Record<string, unknown> }): void {
  const realRoot = fs.realpathSync(root);
  const inToolchain = (input: string) => {
    const toolchain = path.dirname(fs.realpathSync(path.dirname(resolveWranglerPackage(root))));
    return path.resolve(realRoot, input).startsWith(`${toolchain}${path.sep}`);
  };
  const problem = outsideRepoProblem(workerInputsOutside(Object.keys(meta.inputs ?? {}), inToolchain));
  if (problem !== undefined) throw new ArtifactError(problem);
}

interface Metafile {
  inputs?: Record<string, unknown>;
  outputs?: Record<string, { entryPoint?: string; exports?: string[] }>;
}

function bundleExports(meta: Metafile, output: string, root: string): readonly string[] | null {
  for (const [file, info] of Object.entries(meta.outputs ?? {})) {
    if (info.entryPoint && path.resolve(root, file) === output) return info.exports ?? [];
  }
  return null;
}

export async function bundleArtifact(root: string, wrangler: RunWrangler = runWrangler): Promise<BuiltBundle> {
  const dir = bundleDir(root);
  const out = path.join(dir, "out");
  const metafile = path.join(dir, "meta.json");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const { client } = readManifest(root);
  const { configPath, compatibility, tsconfig } = await acceptedConfig(root, wrangler.readConfig ?? readWranglerConfig);
  const alias =
    client === undefined ? [] : await buildClientAlias(root, client.entry, resolveWranglerPackage(root), tsconfig);
  await wrangler(root, ["deploy", "--dry-run", "--outdir", out, "--metafile", metafile, "--config", configPath, "--env-file", os.devNull, ...alias]).catch(
    (error: Error) => {
      throw explainBundleFailure(error, client !== undefined);
    },
  );

  const files = fs.readdirSync(out).filter((file) => !file.endsWith(".map") && file !== "README.md");
  const modules = files.filter((file) => /\.m?js$/.test(file));
  const [file] = modules;
  if (file === undefined || modules.length !== 1 || files.length !== 1) {
    throw new ArtifactError(
      `An artifact bundles to exactly one ES module; this one made ${files.join(", ") || "nothing"}. Text, data and wasm modules aren't supported.`,
    );
  }
  const output = path.join(out, file);
  const meta = JSON.parse(fs.readFileSync(metafile, "utf8")) as Metafile;
  assertInputsInRepo(root, meta);
  const exports = bundleExports(meta, output, root);
  if (exports === null || !exports.includes("default")) {
    throw new ArtifactError("The bundle has no default export: export defineArtifact({ fetch }) as the module's default.");
  }
  const named = exports.filter((name) => name !== "default");
  if (named.length > 0) {
    throw new ArtifactError(`The bundle exports ${named.join(", ")}: an artifact exports only its default handlers.`);
  }
  const module = fs.readFileSync(output, "utf8");
  const bytes = Buffer.byteLength(module);
  if (bytes > BUNDLE_MAX_BYTES) {
    throw new ArtifactError(`The bundle is ${bytes} bytes; the limit is ${BUNDLE_MAX_BYTES}.`);
  }
  return { module, bytes, compatibility };
}
