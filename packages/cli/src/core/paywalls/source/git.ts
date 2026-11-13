import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { TYPES_FILE } from "@/core/paywalls/project/types";
import { ui } from "@/ui";
import { buildCommitMessage, redact, tokenSecret, type CommitMessageInput } from "./commit";
import {
  classifyPath,
  DERIVED_FILES,
  derivedFilesOf,
  isOtherSurfaceDir,
  isSurfaceRoot,
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

const englishEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(env).filter(([key]) => key !== "LANGUAGE")),
  LC_ALL: "C",
});

async function git(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; secrets?: string[] } = {},
): Promise<string> {
  try {
    const { stdout } = await run("git", [...ISOLATION, ...args], {
      cwd: options.cwd,
      env: englishEnv(options.env),
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

export function materializeSourceTree(
  dir: string,
  files: readonly SourceFile[],
  scope: SourceScope,
  options: { onRemote?: boolean; overwrite?: boolean; application?: string } = {},
): void {
  const theirs = new Map<string, Buffer>();
  for (const derived of derivedFilesOf(scope)) {
    const existing = path.join(dir, derived);
    if (fs.existsSync(existing)) theirs.set(derived, fs.readFileSync(existing));
  }
  const remove = (target: string) => fs.rmSync(target, { recursive: true, force: true });
  const keepShared = options.onRemote === true;

  for (const entry of fs.readdirSync(dir)) {
    if (entry === ".git") continue;
    const top = path.join(dir, entry);
    const isDir = fs.lstatSync(top).isDirectory();
    if (keepShared && !(isDir && isSurfaceRoot(entry, scope))) continue;
    if (!isDir) {
      remove(top);
      continue;
    }
    for (const child of fs.readdirSync(top)) {
      const inner = path.join(top, child);
      const childIsDir = fs.lstatSync(inner).isDirectory();
      if (isOtherSurfaceDir(entry, child, scope) && childIsDir) continue;
      if (keepShared && !childIsDir) continue;
      remove(inner);
    }
  }

  const write = (relative: string, data: Buffer | string) => {
    const file = path.join(dir, relative);
    const parts = relative.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const ancestor = path.join(dir, ...parts.slice(0, depth));
      if (fs.existsSync(ancestor) && !fs.lstatSync(ancestor).isDirectory()) remove(ancestor);
    }
    if (fs.existsSync(file) && fs.lstatSync(file).isDirectory()) remove(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };

  const large: string[] = [];
  for (const file of files) {
    if (classifyPath(file.path, scope) === "other") continue;
    if (file.content.byteLength > LARGE_FILE_BYTES) large.push(file.path);
    if (file.path === LOCK_FILE && scope.kind !== "artifact") {
      const repoLock = theirs.get(LOCK_FILE)?.toString("utf8");
      write(
        file.path,
        mergeLockText(repoLock, file.content.toString("utf8"), scope, {
          replaceUnreadable: options.overwrite,
          base: keepShared ? undefined : repoLock,
          application: options.application,
        }),
      );
    } else {
      write(file.path, file.content);
    }
    theirs.delete(file.path);
  }
  for (const [derived, content] of theirs) write(derived, content);

  if (large.length > 0) {
    ui.warn(
      `Committing ${large.length > 1 ? `${large.length} files` : large[0]} over 50 MB — ` +
        `every future clone of this ${scope.kind === "artifact" ? "artifact's" : "app's"} source repo pays for it.`,
    );
  }
}

const SHOWN_FILES = 5;

const listFiles = (files: readonly string[]): string => {
  const shown = files.slice(0, SHOWN_FILES).join(", ");
  const rest = files.length - SHOWN_FILES;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
};

const replaced = (kind: SourceScope["kind"]): string =>
  kind === "project" ? "the project's shared files" : "this paywall's source";

export class SourceConflictError extends Error {
  constructor(
    readonly files: readonly string[],
    kind: SourceScope["kind"] = "paywall",
  ) {
    super(
      kind === "artifact"
        ? `Someone else pushed changes to ${listFiles(files)} since this project last synced. ` +
            "Run `superwall artifacts pull` to bring their changes into this project, then push again, or rerun with --overwrite-source to replace this artifact's source with yours."
        : `Someone else published changes to ${listFiles(files)} since this project last synced. ` +
            "Run `superwall pull` to bring their changes into this project, then publish again — or rerun with --overwrite-source to replace " +
            `${replaced(kind)} with yours.`,
    );
  }
}

export class SourceDivergedError extends Error {
  constructor(
    readonly files: readonly string[],
    kind: SourceScope["kind"] = "paywall",
  ) {
    super(
      kind === "artifact"
        ? `The source repo differs from this project in ${listFiles(files)}, and this project records no sync point to merge from. ` +
            "Run `superwall artifacts pull` to merge the source repo into this project, then push again, or rerun with --overwrite-source to replace this artifact's source with yours."
        : `The source repo differs from this project in ${listFiles(files)}, and superwall.lock records no sync point to merge from. ` +
            "Run `superwall pull` to merge the source repo into this project, then publish again — or rerun with --overwrite-source to replace " +
            `${replaced(kind)} with yours.`,
    );
  }
}

export interface SourceCommit {
  sha: string;
  author: string;
  email: string;
  subject: string;
}

export interface DirectPushInput {
  access: SourceAccess;
  files: readonly SourceFile[];
  message: CommitMessageInput;
  base?: string;
  overwrite?: boolean;
  author?: { name: string; email: string };
  reviewed?: string;
  confirmIncoming?: (commits: readonly SourceCommit[]) => Promise<void>;
}

export interface DirectPushResult {
  commitSha: string;
  status: "committed" | "unchanged";
  syncedTo: string | undefined;
  incoming?: readonly SourceCommit[];
}

const printable = (text: string): string => text.replace(/[\p{Cc}\p{Cf}]/gu, "");

function parseCommits(output: string): SourceCommit[] {
  const fields = output.split("\0");
  const commits: SourceCommit[] = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    commits.push({
      sha: (fields[index] ?? "").trim(),
      author: printable(fields[index + 1] ?? ""),
      email: printable(fields[index + 2] ?? ""),
      subject: printable(fields[index + 3] ?? ""),
    });
  }
  return commits;
}

const PUSH_ATTEMPTS = 3;

export async function pushSourceTree(input: DirectPushInput): Promise<DirectPushResult> {
  const { access } = input;
  const secrets = [access.token, tokenSecret(access.token)];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-source-"));
  const env = gitEnv(access.token);
  const committing = gitEnv(access.token, {
    GIT_AUTHOR_NAME: input.author?.name ?? (process.env.GIT_AUTHOR_NAME || AUTHOR.name),
    GIT_AUTHOR_EMAIL: input.author?.email ?? (process.env.GIT_AUTHOR_EMAIL || AUTHOR.email),
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

  const incoming: SourceCommit[] = [];
  const finished = (result: DirectPushResult): DirectPushResult =>
    incoming.length > 0 ? { ...result, incoming } : result;
  const known = new Set<string>();
  const confirmIncoming = async (from: string, to: string) => {
    if (!input.confirmIncoming) return;
    known.add(from);
    const reviewed = input.reviewed ? await revParse(input.reviewed) : undefined;
    if (reviewed) known.add(reviewed);
    const log = await run(["log", "-z", "--format=%H%x00%an%x00%ae%x00%s", to, ...[...known].map((ref) => `^${ref}`)]);
    const commits = parseCommits(log);
    known.add(to);
    if (commits.length === 0) return;
    await input.confirmIncoming(commits);
    incoming.push(...commits);
  };

  try {
    await cloneSource(access, dir, { env, secrets });

    const scope: SourceScope =
      input.message.kind === "project"
        ? { kind: "project" }
        : { kind: input.message.kind, id: input.message.surface };
    const application =
      input.message.kind === "artifact" ? undefined : input.message.applicationId;
    const head = await revParse("HEAD");
    const base = input.base && head && !input.overwrite ? await revParse(input.base) : undefined;
    if (base && base !== head) await run(["checkout", "--quiet", "--detach", base]);
    const messageFile = path.join(dir, ".git", "SUPERWALL_COMMITMSG");
    fs.writeFileSync(messageFile, buildCommitMessage(input.message));

    const onRemote = head !== undefined && !base;
    const local = onRemote
      ? await snapshotLocal(run, dir, input.files, scope, head, committing)
      : undefined;

    const unsynced = onRemote && scope.kind === "project";

    materializeSourceTree(dir, input.files, scope, {
      onRemote: onRemote && scope.kind !== "artifact",
      overwrite: input.overwrite,
      application,
    });

    await run(["add", "-A"]);
    const dirty = (await run(["status", "--porcelain"])).trim();
    if (dirty === "" && local === undefined) {
      if (base && head && base !== head) await confirmIncoming(base, head);
      return finished({
        commitSha: head ?? "",
        status: "unchanged",
        syncedTo: unsynced ? undefined : (base ?? head),
      });
    }
    if (onRemote && !input.overwrite) {
      const refused = overwrittenPaths(
        await run(["diff", "--cached", "--name-status", "--no-renames", "-z", "HEAD"]),
        derivedFilesOf(scope),
      );
      if (refused.length > 0) throw new SourceDivergedError(refused, scope.kind);
    }

    if (local !== undefined && head !== undefined) {
      const tree = (await run(["write-tree"])).trim();
      const merged = (
        await run(["commit-tree", tree, "-p", head, "-p", local, "-F", messageFile], {
          env: committing,
        })
      ).trim();
      await run(["reset", "--quiet", "--hard", merged]);
    } else {
      await run(["commit", "--quiet", "--no-verify", "-F", messageFile], { env: committing });
    }
    const own = await revParse("HEAD");
    if (!own) throw new Error("The source commit was not created.");
    const syncedTo = unsynced ? undefined : (local ?? own);
    const status = dirty === "" ? "unchanged" : "committed";
    const isAncestor = (ancestor: string, of: string) =>
      run(["merge-base", "--is-ancestor", ancestor, of]).then(
        () => true,
        () => false,
      );
    const parent = base ?? head;

    for (let attempt = 1; ; attempt++) {
      const upstream = parent ? await revParse(`origin/${access.branch}`) : undefined;
      if (upstream && upstream !== parent) {
        if (await isAncestor(own, upstream)) {
          await confirmIncoming(own, upstream);
          return finished({ commitSha: upstream, status: "unchanged", syncedTo });
        }
        await run(["reset", "--quiet", "--hard", own]);
        await mergeUpstream(`origin/${access.branch}`, messageFile, {
          run,
          committing,
          dir,
          own,
          scope,
          base,
          application,
        });
        await confirmIncoming(parent ?? own, upstream);
      }
      try {
        await run(["push", "origin", `HEAD:${access.branch}`]);
        return finished({ commitSha: (await revParse("HEAD")) ?? own, status, syncedTo });
      } catch (error) {
        if (!parent || attempt >= PUSH_ATTEMPTS || !isRejected(error)) throw error;
        await run(["fetch", "--quiet", "origin", access.branch]);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function statIfPresent(file: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(file, { throwIfNoEntry: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
    throw error;
  }
}

async function snapshotLocal(
  run: Run,
  dir: string,
  files: readonly SourceFile[],
  scope: SourceScope,
  head: string,
  committing: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const kept: SourceFile[] = [];
  for (const file of files) {
    if (classifyPath(file.path, scope) !== "other") {
      kept.push(file);
      continue;
    }
    const remote = path.join(dir, file.path);
    if (statIfPresent(remote)?.isFile()) {
      kept.push({ ...file, content: fs.readFileSync(remote) });
    }
  }
  replaceTree(dir, kept);
  await run(["add", "-A"]);
  const tree = (await run(["write-tree"])).trim();
  const remote = (await run(["rev-parse", `${head}^{tree}`])).trim();
  await run(["reset", "--quiet", "--hard", head]);
  await run(["clean", "--quiet", "-d", "-x", "--force"]);
  if (tree === remote) return undefined;
  const snapshot = await run(
    ["commit-tree", tree, "-m", "superwall: the project this push was made from"],
    { env: committing },
  );
  return snapshot.trim();
}

function overwrittenPaths(nameStatus: string, derived: ReadonlySet<string>): string[] {
  const fields = nameStatus.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index];
    const file = fields[index + 1];
    if (file === undefined || status === "A" || derived.has(file)) continue;
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
    base,
    application,
  }: {
    run: Run;
    committing: NodeJS.ProcessEnv;
    dir: string;
    own: string;
    scope: SourceScope;
    base: string | undefined;
    application: string | undefined;
  },
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
  const derived = derivedFilesOf(scope);
  const blocking = conflicted.filter((file) => !derived.has(file));
  const merging = await run(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).then(
    () => true,
    () => false,
  );
  if (blocking.length > 0 || (failure !== undefined && conflicted.length === 0)) {
    await run(["merge", "--abort"]).catch(() => undefined);
    if (blocking.length > 0) throw new SourceConflictError(blocking, scope.kind);
    throw failure;
  }
  if (!merging) return;

  const show = (ref: string, file: string) =>
    run(["show", `${ref}:${file}`]).then(
      (text) => text,
      () => undefined,
    );
  if (scope.kind !== "artifact") {
    const theirsLock = await show(upstream, LOCK_FILE);
    const mineLock = await show(own, LOCK_FILE);
    const baseLock = base === undefined ? undefined : await show(base, LOCK_FILE);
    const lock =
      mineLock === undefined
        ? theirsLock
        : mergeLockText(theirsLock, mineLock, scope, { base: baseLock, application });
    await settle(run, dir, LOCK_FILE, lock);
  }
  for (const file of derived) {
    if (file !== LOCK_FILE) await settle(run, dir, file, await show(own, file));
  }

  await run(["commit", "--quiet", "--no-verify", "-F", messageFile], { env: committing });
}

async function settle(
  run: Run,
  dir: string,
  file: string,
  content: string | undefined,
): Promise<void> {
  if (content === undefined) return;
  fs.writeFileSync(path.join(dir, file), content);
  await run(["add", "--", file]);
}

export class PullConflictError extends Error {
  constructor(readonly files: readonly string[]) {
    super(
      `Your project and the source repo both changed ${listFiles(files)}, so nothing was pulled. ` +
        "To keep your edits, copy those files somewhere first; then rerun with --theirs to take the source repo's version of them.",
    );
  }
}

export interface PulledChange {
  path: string;
  content: Buffer | undefined;
}

export type PullResult =
  | { status: "empty" }
  | {
      status: "pulled";
      head: string;
      changes: PulledChange[];
      lock: string | undefined;
      baseLock: string | undefined;
      types: string | undefined;
    };

export interface PullInput {
  access: SourceAccess;
  files: readonly SourceFile[];
  base?: string;
  theirs?: boolean;
  derived?: ReadonlySet<string>;
}

export async function pullSourceTree(input: PullInput): Promise<PullResult> {
  const { access, derived = DERIVED_FILES } = input;
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
    const blocking = conflicted.filter((file) => !derived.has(file));
    if (blocking.length > 0 && !input.theirs) throw new PullConflictError(blocking);
    const present = new Set(
      (await run(["ls-tree", "-r", "--name-only", "-z", head])).split("\0").filter(Boolean),
    );
    for (const file of conflicted) {
      if (present.has(file)) await run(["--literal-pathspecs", "checkout", head, "--", file]);
      else await run(["--literal-pathspecs", "rm", "--quiet", "--force", "--", file]);
    }
    const unresolved = changedPaths(await run(["diff", "--name-only", "--diff-filter=U", "-z"]));
    if (unresolved.length > 0) throw new PullConflictError(unresolved);

    const changes: PulledChange[] = [];
    const staged = (await run(["diff", "--cached", "--name-status", "--no-renames", "-z", own]))
      .split("\0")
      .filter(Boolean);
    const removed: PulledChange[] = [];
    for (let index = 0; index + 1 < staged.length; index += 2) {
      const status = staged[index];
      const file = staged[index + 1];
      if (file === undefined || derived.has(file)) continue;
      if (status === "D") {
        removed.push({ path: file, content: undefined });
        continue;
      }
      const stat = fs.lstatSync(path.join(dir, file), { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) {
        throw new Error(
          `The source repo has ${file} as a symlink — the CLI only pulls regular files.`,
        );
      }
      changes.push({
        path: file,
        content: stat ? fs.readFileSync(path.join(dir, file)) : undefined,
      });
    }
    changes.sort((a, b) => a.path.localeCompare(b.path));
    changes.unshift(...removed.sort((a, b) => a.path.localeCompare(b.path)));
    const shown = (name: string) =>
      present.has(name) ? run(["show", `${head}:${name}`]) : undefined;
    return {
      status: "pulled",
      head,
      changes,
      lock: await shown(LOCK_FILE),
      baseLock: base
        ? await run(["show", `${base}:${LOCK_FILE}`]).then(
            (text) => text,
            () => undefined,
          )
        : undefined,
      types: await shown(TYPES_FILE),
    };
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
