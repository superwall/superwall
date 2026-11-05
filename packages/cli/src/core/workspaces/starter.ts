import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { CommandContext } from "@/program/command";
import { downloadRepoDir, PUBLIC_REPO, RepoDownloadError, type FetchLike } from "@/core/repo/download";
import { MANIFEST_FILE, readManifest, VENDORED_SDK, WorkspaceError } from "./project";
import { STARTER_DIR, vendoredVersion } from "./sdk";

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
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
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
    fs.rmSync(target, { recursive: true, force: true });
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

async function downloadSdk(target: string, fetchImpl: FetchLike): Promise<string> {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-workspace-sdk-"));
  try {
    await downloadRepoDir(
      `${STARTER_DIR}/vendor/workspace-sdk`,
      stage,
      `No workspace SDK at ${STARTER_DIR} in github.com/${PUBLIC_REPO}. Update the CLI with \`superwall upgrade\`.`,
      fetchImpl,
    );
    const version = readStageVersion(stage);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(stage, target, { recursive: true });
    return version;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function readStageVersion(stage: string): string {
  const { version } = JSON.parse(fs.readFileSync(path.join(stage, "package.json"), "utf8")) as { version?: string };
  if (typeof version !== "string") throw new RepoDownloadError("The downloaded workspace SDK has no version.");
  return version;
}

export interface UpdateInput {
  dir?: string;
  install: boolean;
}

export async function runWorkspaceUpdate(
  ctx: CommandContext<"none">,
  input: UpdateInput,
  runtime: CreateRuntime = {},
): Promise<void> {
  const root = path.resolve(input.dir ?? process.cwd());
  readManifest(root);
  const before = vendoredVersion(root);
  const spin = ctx.ui.spinner();
  spin.start("Downloading the workspace SDK");
  let version: string;
  try {
    version = await downloadSdk(path.join(root, VENDORED_SDK), runtime.fetch ?? fetch);
  } catch (error) {
    spin.stop("The workspace SDK didn't download");
    throw error;
  }
  spin.stop(before === version ? `Already on the latest workspace SDK, ${version}` : `Workspace SDK ${version}`);

  editJson(path.join(root, "package.json"), (value) => {
    value.dependencies = { ...value.dependencies, "@superwall/workspace-sdk": "file:vendor/workspace-sdk" };
  });
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
