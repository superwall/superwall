import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { CommandContext } from "@/program/command";
import { downloadRepoDir, PUBLIC_REPO, RepoDownloadError, type FetchLike } from "@/core/repo/download";
import { MANIFEST_FILE, readManifest, VENDORED_SDK, WorkspaceError } from "./project";
import { compareVersions, STARTER_DIR, vendoredVersion } from "./sdk";

const run = promisify(execFile);

type Install = (root: string) => Promise<void>;

const npmInstall: Install = async (root) => {
  await run("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: root,
    shell: process.platform === "win32",
    timeout: 300_000,
  });
};

export interface CreateRuntime {
  fetch?: FetchLike;
  install?: Install;
  rename?: typeof fs.renameSync;
}

const packageNameOf = (dir: string): string =>
  path
    .basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "my-workspace";

const titleOf = (name: string): string => {
  const words = name.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function editJson(file: string, edit: (value: Record<string, any>) => void): void {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, any>;
  edit(parsed);
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
}

function adoptStarter(target: string, name: string): void {
  editJson(path.join(target, "package.json"), (value) => {
    value.name = name;
  });
  editJson(path.join(target, "package-lock.json"), (value) => {
    value.name = name;
    if (value.packages?.[""]) value.packages[""].name = name;
  });
  editJson(path.join(target, MANIFEST_FILE), (value) => {
    value.name = titleOf(name);
    for (const entrypoint of value.entrypoints ?? []) {
      if (entrypoint.slot === "org.page@1") entrypoint.title = titleOf(name);
    }
  });
  const wrangler = path.join(target, "wrangler.jsonc");
  fs.writeFileSync(wrangler, fs.readFileSync(wrangler, "utf8").replace("superwall-workspace-starter", name));
}

export interface CreateInput {
  dir?: string;
  install: boolean;
}

export async function runWorkspaceCreate(
  ctx: CommandContext<"none">,
  input: CreateInput,
  runtime: CreateRuntime = {},
): Promise<void> {
  const target = path.resolve(input.dir ?? "my-workspace");
  const existed = fs.existsSync(target);
  if (existed && !fs.statSync(target).isDirectory()) {
    throw new WorkspaceError(`${target} is a file. Pick an empty directory.`);
  }
  if (existed && fs.readdirSync(target).length > 0) {
    throw new WorkspaceError(`${target} already has files in it. Pick an empty directory.`);
  }
  ctx.ui.intro("New workspace");
  const spin = ctx.ui.spinner();
  spin.start(`Downloading the starter from github.com/${PUBLIC_REPO}`);
  try {
    await downloadRepoDir(
      STARTER_DIR,
      target,
      `No starter at ${STARTER_DIR} in github.com/${PUBLIC_REPO}. Update the CLI with \`superwall upgrade\`.`,
      runtime.fetch ?? fetch,
    );
    adoptStarter(target, packageNameOf(target));
  } catch (error) {
    spin.stop("The starter didn't download");
    if (existed) {
      for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    } else {
      fs.rmSync(target, { recursive: true, force: true });
    }
    throw error;
  }
  spin.stop("Downloaded the starter");

  let installed = false;
  if (input.install) {
    const installing = ctx.ui.spinner();
    installing.start("Installing dependencies");
    try {
      await (runtime.install ?? npmInstall)(target);
      installing.stop("Installed dependencies");
      installed = true;
    } catch {
      installing.stop("`npm install` failed. Run it yourself in the new directory.");
    }
  }

  const relative = path.relative(process.cwd(), target) || ".";
  const next = [`cd ${relative}`, ...(installed ? [] : ["npm install"]), "superwall workspaces dev"];
  ctx.ui.note(next.join("\n"), "Next");
}

async function downloadSdk(fetchImpl: FetchLike): Promise<{ stage: string; version: string }> {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-workspace-sdk-"));
  try {
    await downloadRepoDir(
      `${STARTER_DIR}/vendor/workspace-sdk`,
      stage,
      `No workspace SDK at ${STARTER_DIR} in github.com/${PUBLIC_REPO}. Update the CLI with \`superwall upgrade\`.`,
      fetchImpl,
    );
    return { stage, version: readStageVersion(stage) };
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

function replaceDirectory(stage: string, target: string, rename: typeof fs.renameSync = fs.renameSync): void {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const incoming = fs.mkdtempSync(path.join(parent, ".workspace-sdk-new-"));
  const outgoing = `${incoming}-old`;
  fs.cpSync(stage, incoming, { recursive: true });
  const hadTarget = fs.existsSync(target);
  try {
    if (hadTarget) rename(target, outgoing);
    rename(incoming, target);
  } catch (error) {
    if (hadTarget && !fs.existsSync(target) && fs.existsSync(outgoing)) rename(outgoing, target);
    fs.rmSync(incoming, { recursive: true, force: true });
    throw error;
  }
  fs.rmSync(outgoing, { recursive: true, force: true });
}

function pointPackageAtSdk(file: string): void {
  const text = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(text) as { dependencies?: Record<string, string> };
  if (parsed.dependencies?.["@superwall/workspace-sdk"] === "file:vendor/workspace-sdk") return;
  parsed.dependencies = { ...parsed.dependencies, "@superwall/workspace-sdk": "file:vendor/workspace-sdk" };
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, indent)}${text.endsWith("\n") ? "\n" : ""}`);
}

function readStageVersion(stage: string): string {
  const { version } = JSON.parse(fs.readFileSync(path.join(stage, "package.json"), "utf8")) as { version?: string };
  if (typeof version !== "string") throw new RepoDownloadError("The downloaded workspace SDK has no version.");
  return version;
}

export interface UpdateInput {
  dir?: string;
  install: boolean;
  force?: boolean;
}

export async function runWorkspaceUpdate(
  ctx: CommandContext<"none">,
  input: UpdateInput,
  runtime: CreateRuntime = {},
): Promise<void> {
  const root = path.resolve(input.dir ?? process.cwd());
  readManifest(root);
  const packageFile = path.join(root, "package.json");
  if (!fs.existsSync(packageFile)) {
    throw new WorkspaceError(`No package.json in ${root}, so nothing was changed. A workspace needs one to depend on the SDK.`);
  }
  const before = vendoredVersion(root);
  const spin = ctx.ui.spinner();
  spin.start("Downloading the workspace SDK");
  let downloaded: { stage: string; version: string };
  try {
    downloaded = await downloadSdk(runtime.fetch ?? fetch);
  } catch (error) {
    spin.stop("The workspace SDK didn't download");
    throw error;
  }
  const { stage, version } = downloaded;
  try {
    if (before !== undefined && compareVersions(before, version) > 0 && !input.force) {
      spin.stop(`Yours is newer than the latest published one, ${version}`);
      ctx.ui.warn(`Left workspace SDK ${before} alone. Pass --force to replace it with ${version}.`);
      return;
    }
    replaceDirectory(stage, path.join(root, VENDORED_SDK), runtime.rename);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  spin.stop(before === version ? `Already on the latest workspace SDK, ${version}` : `Workspace SDK ${version}`);
  pointPackageAtSdk(packageFile);

  if (!input.install) {
    ctx.ui.info("Run `npm install` to update package-lock.json, then commit vendor/workspace-sdk and the lockfile.");
    return;
  }
  try {
    await (runtime.install ?? npmInstall)(root);
    ctx.ui.success("Updated package-lock.json. Commit vendor/workspace-sdk and the lockfile.");
  } catch {
    ctx.ui.warn("`npm install` failed. Run it yourself to update package-lock.json.");
  }
}
