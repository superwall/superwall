import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { promisify } from "node:util";
import { buildClientAlias, explainBundleFailure } from "./client-build";
import { bundleDir, readManifest, WorkspaceError } from "./project";
import { BUNDLE_MAX_BYTES } from "./wire";

const run = promisify(execFile);

export interface BuiltBundle {
  module: string;
  bytes: number;
}

export type RunWrangler = (root: string, args: readonly string[]) => Promise<void>;

export function resolveWranglerPackage(root: string): string {
  try {
    return createRequire(path.join(root, "package.json")).resolve("wrangler/package.json");
  } catch {
    throw new WorkspaceError(
      "This workspace needs wrangler installed to bundle it. Run `npm install`, or `npm install -D wrangler` if it isn't in package.json.",
    );
  }
}

const runWrangler: RunWrangler = async (root, args) => {
  const bin = path.join(path.dirname(resolveWranglerPackage(root)), "bin", "wrangler.js");
  try {
    await run("node", [bin, ...args], {
      cwd: root,
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTS: "false", FORCE_COLOR: "0" },
    });
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    const output = `${stdout}\n${stderr}`.trim().split("\n").slice(-30).join("\n");
    throw new WorkspaceError(`The workspace didn't bundle:\n${output}`);
  }
};

function bundleExports(metafile: string, output: string, root: string): readonly string[] | null {
  const meta = JSON.parse(fs.readFileSync(metafile, "utf8")) as {
    outputs?: Record<string, { entryPoint?: string; exports?: string[] }>;
  };
  for (const [file, info] of Object.entries(meta.outputs ?? {})) {
    if (info.entryPoint && path.resolve(root, file) === output) return info.exports ?? [];
  }
  return null;
}

export async function bundleWorkspace(root: string, wrangler: RunWrangler = runWrangler): Promise<BuiltBundle> {
  const dir = bundleDir(root);
  const out = path.join(dir, "out");
  const metafile = path.join(dir, "meta.json");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const { client } = readManifest(root);
  const alias = client === undefined ? [] : await buildClientAlias(root, client.entry, resolveWranglerPackage(root));
  await wrangler(root, ["deploy", "--dry-run", "--outdir", out, "--metafile", metafile, ...alias]).catch((error: Error) => {
    throw explainBundleFailure(error, client !== undefined);
  });

  const files = fs.readdirSync(out).filter((file) => !file.endsWith(".map") && file !== "README.md");
  const modules = files.filter((file) => /\.m?js$/.test(file));
  const [file] = modules;
  if (file === undefined || modules.length !== 1 || files.length !== 1) {
    throw new WorkspaceError(
      `A workspace bundles to exactly one ES module; this one made ${files.join(", ") || "nothing"}. Text, data and wasm modules aren't supported.`,
    );
  }
  const output = path.join(out, file);
  const exports = bundleExports(metafile, output, root);
  if (exports === null || !exports.includes("default")) {
    throw new WorkspaceError("The bundle has no default export: export defineWorkspace({ fetch }) as the module's default.");
  }
  const named = exports.filter((name) => name !== "default");
  if (named.length > 0) {
    throw new WorkspaceError(`The bundle exports ${named.join(", ")}: a workspace exports only its default handlers.`);
  }
  const module = fs.readFileSync(output, "utf8");
  const bytes = Buffer.byteLength(module);
  if (bytes > BUNDLE_MAX_BYTES) {
    throw new WorkspaceError(`The bundle is ${bytes} bytes; the limit is ${BUNDLE_MAX_BYTES}.`);
  }
  return { module, bytes };
}
