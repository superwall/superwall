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

export class SourceConflictError extends Error {
  constructor(readonly files: readonly string[]) {
    super(
      `Someone else published changes to ${files.length === 1 ? files[0] : `${files.length} of the same files (${files.join(", ")})`} since this project was last in sync — bring their changes into your project first, then publish again.`,
    );
  }
}

export interface DirectPushInput {
  access: SourceAccess;
  files: readonly SourceFile[];
  message: CommitMessageInput;
  base?: string;
}

export interface DirectPushResult {
  commitSha: string;
  status: "committed" | "unchanged";
  syncedTo: string | undefined;
}

const PUSH_ATTEMPTS = 3;

export async function pushSourceTree(input: DirectPushInput): Promise<DirectPushResult> {
  const { access } = input;
  const secrets = [access.token, tokenSecret(access.token)];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-source-"));
  const env = gitEnv(access.token);
  const committing = gitEnv(access.token, {
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || AUTHOR.name,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || AUTHOR.email,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
  });
  const run = (args: string[], options: { env?: NodeJS.ProcessEnv } = {}) =>
    git(args, { cwd: dir, env: options.env ?? env, secrets });
  const revParse = (ref: string) =>
    run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).then(
      (out) => out.trim(),
      () => undefined,
    );

  try {
    await git(["clone", "--branch", access.branch, access.remote, dir], {
      env,
      secrets,
    }).catch(async (error: unknown) => {
      await git(["clone", access.remote, dir], { env, secrets }).catch(() => {
        throw error;
      });
    });

    const head = await revParse("HEAD");
    const base = input.base && head ? await revParse(input.base) : undefined;
    if (base && base !== head) await run(["checkout", "--quiet", "--detach", base]);

    materializeSourceTree(dir, input.files);

    await run(["add", "-A"]);
    const dirty = (await run(["status", "--porcelain"])).trim();
    if (dirty === "") return { commitSha: head ?? "", status: "unchanged", syncedTo: base ?? head };

    const messageFile = path.join(dir, ".git", "SUPERWALL_COMMITMSG");
    fs.writeFileSync(messageFile, buildCommitMessage(input.message));
    await run(["commit", "--quiet", "-F", messageFile], { env: committing });
    const own = await revParse("HEAD");
    if (!own) throw new Error("The source commit was not created.");
    const isAncestor = (ancestor: string, of: string) =>
      run(["merge-base", "--is-ancestor", ancestor, of]).then(
        () => true,
        () => false,
      );

    for (let attempt = 1; ; attempt++) {
      const upstream = base ? await revParse(`origin/${access.branch}`) : undefined;
      if (upstream && upstream !== base) {
        if (await isAncestor(own, upstream))
          return { commitSha: upstream, status: "unchanged", syncedTo: own };
        await run(["reset", "--quiet", "--hard", own]);
        await mergeUpstream(`origin/${access.branch}`, messageFile, { run, committing });
      }
      try {
        await run(["push", "origin", `HEAD:${access.branch}`]);
        return { commitSha: (await revParse("HEAD")) ?? own, status: "committed", syncedTo: own };
      } catch (error) {
        if (!base || attempt >= PUSH_ATTEMPTS || !isRejected(error)) throw error;
        await run(["fetch", "--quiet", "origin", access.branch]);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function mergeUpstream(
  upstream: string,
  messageFile: string,
  {
    run,
    committing,
  }: {
    run: (args: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<string>;
    committing: NodeJS.ProcessEnv;
  },
): Promise<void> {
  try {
    await run(["merge", "--quiet", "--no-ff", "-F", messageFile, upstream], { env: committing });
  } catch (error) {
    const conflicted = await run(["diff", "--name-only", "--diff-filter=U"]).then(
      (out) =>
        out
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      () => [],
    );
    await run(["merge", "--abort"]).catch(() => undefined);
    if (conflicted.length > 0) throw new SourceConflictError(conflicted);
    throw error;
  }
}

const isRejected = (error: unknown): boolean =>
  error instanceof GitError &&
  /rejected|non-fast-forward|fetch first|stale info|failed to push some refs/i.test(error.message);
