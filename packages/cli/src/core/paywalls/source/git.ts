import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { ui } from "@/ui";
import { buildCommitMessage, redact, tokenSecret, type CommitMessageInput } from "./commit";
import {
  classifyPath,
  DERIVED_FILES,
  isOtherSurfaceDir,
  LOCK_FILE,
  mergeLockText,
  type SourceScope,
} from "./scope";
import type { SourceFile } from "./source";

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

const REPOSITORY_ENV = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_CONFIG_PARAMETERS",
]);

const gitEnv = (token: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !REPOSITORY_ENV.has(key))),
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0: `Authorization: Bearer ${tokenSecret(token)}`,
  GIT_TERMINAL_PROMPT: "0",
  ...extra,
});

const GIT_TIMEOUT_MS = 5 * 60 * 1000;

const ISOLATION = [
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.autocrlf=false",
];

async function git(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; secrets?: string[] } = {},
): Promise<string> {
  try {
    const { stdout } = await run("git", [...ISOLATION, ...args], {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
    });
    return stdout;
  } catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "killed") === true) {
      throw new GitError(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS / 60_000} minutes.`);
    }
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

export function materializeSourceTree(dir: string, files: readonly SourceFile[], scope: SourceScope): void {
  const theirs = new Map<string, Buffer>();
  for (const derived of DERIVED_FILES) {
    const existing = path.join(dir, derived);
    if (fs.existsSync(existing)) theirs.set(derived, fs.readFileSync(existing));
  }
  const remove = (target: string) => fs.rmSync(target, { recursive: true, force: true });

  for (const entry of fs.readdirSync(dir)) {
    if (entry === ".git") continue;
    const top = path.join(dir, entry);
    if (!fs.lstatSync(top).isDirectory()) {
      remove(top);
      continue;
    }
    for (const child of fs.readdirSync(top)) {
      const inner = path.join(top, child);
      if (isOtherSurfaceDir(entry, child, scope) && fs.lstatSync(inner).isDirectory()) continue;
      remove(inner);
    }
  }

  const write = (relative: string, data: Buffer | string) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };

  const large: string[] = [];
  for (const file of files) {
    if (classifyPath(file.path, scope) === "other") continue;
    if (file.content.byteLength > LARGE_FILE_BYTES) large.push(file.path);
    if (file.path === LOCK_FILE) {
      write(file.path, mergeLockText(theirs.get(LOCK_FILE)?.toString("utf8"), file.content.toString("utf8"), scope));
    } else {
      write(file.path, file.content);
    }
    theirs.delete(file.path);
  }
  for (const [derived, content] of theirs) write(derived, content);

  if (large.length > 0) {
    ui.warn(
      `Committing ${large.length > 1 ? `${large.length} files` : large[0]} over 50 MB — ` +
        "every future clone of this app's source repo pays for it.",
    );
  }
}

const SHOWN_FILES = 5;

const listFiles = (files: readonly string[]): string => {
  const shown = files.slice(0, SHOWN_FILES).join(", ");
  const rest = files.length - SHOWN_FILES;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
};

export class SourceConflictError extends Error {
  constructor(readonly files: readonly string[]) {
    super(
      `Someone else published changes to ${listFiles(files)} since this project last synced. ` +
        "Pull their commits into this project, then publish again — or rerun with --overwrite-source to replace their version with yours.",
    );
  }
}

export class SourceDivergedError extends Error {
  constructor(readonly files: readonly string[]) {
    super(
      `The source repo differs from this project in ${listFiles(files)}, and superwall.lock records no sync point to merge from. ` +
        "Pull the latest superwall.lock, or rerun with --overwrite-source to replace the remote source with yours.",
    );
  }
}

export interface DirectPushInput {
  access: SourceAccess;
  files: readonly SourceFile[];
  message: CommitMessageInput;
  base?: string;
  overwrite?: boolean;
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
    await cloneSource(access, dir, { env, secrets });

    const scope: SourceScope = { kind: input.message.kind, id: input.message.surface };
    const head = await revParse("HEAD");
    const base = input.base && head && !input.overwrite ? await revParse(input.base) : undefined;
    if (base && base !== head) await run(["checkout", "--quiet", "--detach", base]);

    materializeSourceTree(dir, input.files, scope);

    await run(["add", "-A"]);
    const dirty = (await run(["status", "--porcelain"])).trim();
    if (dirty === "") return { commitSha: head ?? "", status: "unchanged", syncedTo: base ?? head };
    if (head && !base && !input.overwrite) {
      const refused = overwrittenPaths(
        await run(["diff", "--cached", "--name-status", "--no-renames", "-z", "HEAD"]),
      );
      if (refused.length > 0) throw new SourceDivergedError(refused);
    }

    const messageFile = path.join(dir, ".git", "SUPERWALL_COMMITMSG");
    fs.writeFileSync(messageFile, buildCommitMessage(input.message));
    await run(["commit", "--quiet", "--no-verify", "-F", messageFile], { env: committing });
    const own = await revParse("HEAD");
    if (!own) throw new Error("The source commit was not created.");
    const isAncestor = (ancestor: string, of: string) =>
      run(["merge-base", "--is-ancestor", ancestor, of]).then(
        () => true,
        () => false,
      );
    const parent = base ?? head;

    for (let attempt = 1; ; attempt++) {
      const upstream = parent ? await revParse(`origin/${access.branch}`) : undefined;
      if (upstream && upstream !== parent) {
        if (await isAncestor(own, upstream))
          return { commitSha: upstream, status: "unchanged", syncedTo: own };
        await run(["reset", "--quiet", "--hard", own]);
        await mergeUpstream(`origin/${access.branch}`, messageFile, { run, committing, dir, own, scope });
      }
      try {
        await run(["push", "origin", `HEAD:${access.branch}`]);
        return { commitSha: (await revParse("HEAD")) ?? own, status: "committed", syncedTo: own };
      } catch (error) {
        if (!parent || attempt >= PUSH_ATTEMPTS || !isRejected(error)) throw error;
        await run(["fetch", "--quiet", "origin", access.branch]);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function overwrittenPaths(nameStatus: string): string[] {
  const fields = nameStatus.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index];
    const file = fields[index + 1];
    if (file === undefined || status === "A" || DERIVED_FILES.has(file)) continue;
    paths.push(file);
  }
  return paths;
}

const CLONE_ATTEMPTS = [
  ["--filter=blob:none", "--branch"],
  ["--branch"],
  ["--filter=blob:none"],
  [],
];

const CLONE_FALLBACK = /remote branch .* not found|filter/i;

async function cloneSource(
  access: SourceAccess,
  dir: string,
  options: { env: NodeJS.ProcessEnv; secrets: string[] },
): Promise<void> {
  let first: unknown;
  for (const flags of CLONE_ATTEMPTS) {
    const branch = flags.includes("--branch") ? [access.branch] : [];
    try {
      await git(["clone", "--quiet", ...flags, ...branch, access.remote, dir], options);
      return;
    } catch (error) {
      first ??= error;
      if (!(error instanceof GitError) || !CLONE_FALLBACK.test(error.message)) throw error;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir);
    }
  }
  throw first;
}

type Run = (args: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<string>;

async function mergeUpstream(
  upstream: string,
  messageFile: string,
  {
    run,
    committing,
    dir,
    own,
    scope,
  }: { run: Run; committing: NodeJS.ProcessEnv; dir: string; own: string; scope: SourceScope },
): Promise<void> {
  let failure: unknown;
  await run(["merge", "--quiet", "--no-ff", "--no-commit", upstream], { env: committing }).catch(
    (error: unknown) => {
      failure = error;
    },
  );
  const conflicted = (await run(["diff", "--name-only", "--diff-filter=U", "-z"]).catch(() => ""))
    .split("\0")
    .filter(Boolean);
  const blocking = conflicted.filter((file) => !DERIVED_FILES.has(file));
  const merging = await run(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).then(
    () => true,
    () => false,
  );
  if (blocking.length > 0 || (failure !== undefined && conflicted.length === 0)) {
    await run(["merge", "--abort"]).catch(() => undefined);
    if (blocking.length > 0) throw new SourceConflictError(blocking);
    throw failure;
  }
  if (!merging) return;

  const show = (ref: string, file: string) =>
    run(["show", `${ref}:${file}`]).then(
      (text) => text,
      () => undefined,
    );
  const theirsLock = await show(upstream, LOCK_FILE);
  const mineLock = await show(own, LOCK_FILE);
  const lock = mineLock === undefined ? theirsLock : mergeLockText(theirsLock, mineLock, scope);
  await settle(run, dir, LOCK_FILE, lock);
  for (const file of DERIVED_FILES) {
    if (file !== LOCK_FILE) await settle(run, dir, file, await show(own, file));
  }

  await run(["commit", "--quiet", "--no-verify", "-F", messageFile], { env: committing });
}

async function settle(run: Run, dir: string, file: string, content: string | undefined): Promise<void> {
  if (content === undefined) return;
  fs.writeFileSync(path.join(dir, file), content);
  await run(["add", "--", file]);
}

export class PullConflictError extends Error {
  constructor(readonly files: readonly string[]) {
    super(
      `Your project and the source repo both changed ${listFiles(files)}, so nothing was pulled. ` +
        "Rerun with --theirs to take the source repo's version of them (your edits to them are lost), " +
        "or back up your copies and rerun with --theirs.",
    );
  }
}

export interface PulledChange {
  path: string;
  content: Buffer | undefined;
}

export type PullResult =
  | { status: "empty" }
  | { status: "pulled"; head: string; changes: PulledChange[]; lock: string | undefined };

export interface PullInput {
  access: SourceAccess;
  files: readonly SourceFile[];
  base?: string;
  theirs?: boolean;
}

export async function pullSourceTree(input: PullInput): Promise<PullResult> {
  const { access } = input;
  const secrets = [access.token, tokenSecret(access.token)];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-pull-"));
  const env = gitEnv(access.token, {
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
  });
  const run = (args: string[]) => git(args, { cwd: dir, env, secrets });
  const revParse = (ref: string) =>
    run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).then(
      (out) => out.trim(),
      () => undefined,
    );

  try {
    await cloneSource(access, dir, { env, secrets });
    const head = await revParse("HEAD");
    if (!head) return { status: "empty" };

    const base = input.base ? await revParse(input.base) : undefined;
    if (base) {
      await run(["checkout", "--quiet", "--detach", base]);
    } else {
      await run(["checkout", "--quiet", "--orphan", "superwall-local"]);
    }
    replaceTree(dir, input.files);
    await run(["add", "-A"]);
    await run(["commit", "--quiet", "--no-verify", "--allow-empty", "-m", "Local project"]);
    const own = await revParse("HEAD");
    if (!own) throw new Error("The local snapshot commit was not created.");

    let failure: unknown;
    await run([
      "merge",
      "--quiet",
      "--no-ff",
      "--no-commit",
      ...(base ? [] : ["--allow-unrelated-histories"]),
      head,
    ]).catch((error: unknown) => {
      failure = error;
    });
    const conflicted = changedPaths(await run(["diff", "--name-only", "--diff-filter=U", "-z"]));
    if (failure !== undefined && conflicted.length === 0) throw failure;
    const blocking = conflicted.filter((file) => !DERIVED_FILES.has(file));
    if (blocking.length > 0 && !input.theirs) throw new PullConflictError(blocking);
    const present = new Set(
      (await run(["ls-tree", "-r", "--name-only", "-z", head])).split("\0").filter(Boolean),
    );
    for (const file of conflicted) {
      if (present.has(file)) await run(["checkout", head, "--", file]);
      else await run(["rm", "--quiet", "--force", "--", file]);
    }

    const changes: PulledChange[] = [];
    for (const file of changedPaths(await run(["diff", "--cached", "--name-only", "--no-renames", "-z", own]))) {
      if (DERIVED_FILES.has(file)) continue;
      const stat = fs.lstatSync(path.join(dir, file), { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) {
        throw new Error(`The source repo has ${file} as a symlink — the CLI only pulls regular files.`);
      }
      changes.push({ path: file, content: stat ? fs.readFileSync(path.join(dir, file)) : undefined });
    }
    const lock = present.has(LOCK_FILE) ? await run(["show", `${head}:${LOCK_FILE}`]) : undefined;
    return { status: "pulled", head, changes, lock };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const changedPaths = (output: string): string[] => output.split("\0").filter(Boolean).sort();

function replaceTree(dir: string, files: readonly SourceFile[]): void {
  for (const entry of fs.readdirSync(dir)) {
    if (entry !== ".git") fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
  for (const file of files) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }
}

const isRejected = (error: unknown): boolean =>
  error instanceof GitError &&
  /rejected|non-fast-forward|fetch first|stale info|failed to push some refs/i.test(error.message);
