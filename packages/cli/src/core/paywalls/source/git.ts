import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { buildCommitMessage, redact, tokenSecret, type CommitMessageInput } from "./commit";
import type { SourceFile } from "./source";
import { ui } from "@/ui";

const run = promisify(execFile);

const AUTHOR = { name: "Superwall", email: "publish@superwall.com" };

export class GitError extends Error {}

export interface SourceAccess {
  repo: string;
  remote: string;
  branch: string;
  token: string;
  tokenId: string;
}

const gitEnv = (token: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0: `Authorization: Bearer ${tokenSecret(token)}`,
  GIT_TERMINAL_PROMPT: "0",
  ...extra,
});

async function git(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; secrets?: string[] } = {},
): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const detail =
      typeof error === "object" && error !== null
        ? String(Reflect.get(error, "stderr") ?? Reflect.get(error, "message") ?? error)
        : String(error);
    throw new GitError(
      redact(`git ${args[0]} failed: ${gitReason(detail)}`, ...(options.secrets ?? [])),
    );
  }
}

export function gitReason(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("Command failed:"));
  const named = lines.find((line) => /^(fatal|error):/.test(line));
  const line = named ?? lines[lines.length - 1] ?? "";
  return line.replace(/^(fatal|error):\s*/, "") || "git reported no reason.";
}

export async function gitAvailable(): Promise<boolean> {
  try {
    await run("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export function materializeSourceTree(dir: string, files: readonly SourceFile[]): void {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === ".git") continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }

  const write = (relative: string, data: Buffer | string) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };

  const large: string[] = [];
  for (const file of files) {
    if (file.content.byteLength > LARGE_FILE_BYTES) large.push(file.path);
    write(file.path, file.content);
  }

  if (large.length > 0) {
    ui.warn(
      `Committing ${large.length > 1 ? `${large.length} files` : large[0]} over 50 MB — ` +
        "every future clone of this app's source repo pays for it.",
    );
  }
}

export interface DirectPushInput {
  access: SourceAccess;
  files: readonly SourceFile[];
  message: CommitMessageInput;
}

export interface DirectPushResult {
  commitSha: string;
  status: "committed" | "unchanged";
}

export async function pushSourceTree(input: DirectPushInput): Promise<DirectPushResult> {
  const { access } = input;
  const secrets = [access.token, tokenSecret(access.token)];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-source-"));
  const env = gitEnv(access.token);

  try {
    await git(["clone", "--depth", "1", "--branch", access.branch, access.remote, dir], {
      env,
      secrets,
    }).catch(async (error: unknown) => {
      await git(["clone", "--depth", "1", access.remote, dir], { env, secrets }).catch(() => {
        throw error;
      });
    });

    materializeSourceTree(dir, input.files);

    await git(["add", "-A"], { cwd: dir, env, secrets });
    const dirty = (await git(["status", "--porcelain"], { cwd: dir, env, secrets })).trim();

    if (dirty === "") {
      const head = (await git(["rev-parse", "HEAD"], { cwd: dir, env, secrets })).trim();
      return { commitSha: head, status: "unchanged" };
    }

    const messageFile = path.join(dir, ".git", "SUPERWALL_COMMITMSG");
    fs.writeFileSync(messageFile, buildCommitMessage(input.message));
    await git(["commit", "-F", messageFile], {
      cwd: dir,
      env: gitEnv(access.token, {
        GIT_AUTHOR_NAME: AUTHOR.name,
        GIT_AUTHOR_EMAIL: AUTHOR.email,
        GIT_COMMITTER_NAME: AUTHOR.name,
        GIT_COMMITTER_EMAIL: AUTHOR.email,
      }),
      secrets,
    });

    await git(["push", "origin", `HEAD:${access.branch}`], { cwd: dir, env, secrets });
    const head = (await git(["rev-parse", "HEAD"], { cwd: dir, env, secrets })).trim();
    return { commitSha: head, status: "committed" };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
