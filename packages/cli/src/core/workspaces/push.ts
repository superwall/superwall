import { setTimeout as sleep } from "node:timers/promises";
import type { CommandContext } from "@/program/command";
import { ApiError, ApiUnreachableError, type SuperwallApi } from "@/core/api/client";
import {
  gitAvailable,
  pushSourceTree,
  type DirectPushResult,
  type SourceAccess,
  type SourceCommit,
} from "@/core/paywalls/source/git";
import { collectSourceFiles, type SourceFile } from "@/core/paywalls/source/source";
import { VERSION } from "@/environment";
import {
  createWorkspace,
  getBuild,
  getMe,
  listWorkspaces,
  mintSourceAccess,
  startBuild,
  type Workspace,
  type WorkspaceBuild,
} from "./api";
import { readBinding, readSourceFile, writeBinding, type WorkspaceBinding } from "./binding";
import { resolveOrganization } from "./organization";
import { readProject, WorkspaceError, type WorkspaceProject } from "./project";
import { workspaceUrl } from "./resolve";
import { vendoredVersion, warnIfSdkBehind } from "./sdk";

const PUSH_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;
const POLL_FAILURES_ALLOWED = 5;

export interface PushInput {
  dir?: string;
  org?: string;
  m?: string;
  overwriteSource: boolean;
  acceptMergedCommits?: boolean;
}

export interface PushSeams {
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  fetchVersion?: Parameters<typeof warnIfSdkBehind>[2];
  hasGit?: () => Promise<boolean>;
}

export const toSourceAccess = (access: Awaited<ReturnType<typeof mintSourceAccess>>): SourceAccess => ({
  repo: access.repo,
  remote: access.remote,
  branch: access.branch,
  token: access.token,
  tokenId: access.token_id,
});

export function slugOfName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  if (/^[a-z][a-z0-9-]+$/.test(slug)) return slug;
  return `ws-${slug || "workspace"}`.slice(0, 63).replace(/-+$/, "");
}

const isConflict = (error: unknown): boolean => error instanceof ApiError && error.status === 409;

async function linkedWorkspace(
  ctx: CommandContext<"required">,
  project: WorkspaceProject,
  org: string | undefined,
): Promise<WorkspaceBinding> {
  const existing = readBinding(project.root);
  if (existing) return existing;

  const organizationId = await resolveOrganization(ctx, org);
  const slug = slugOfName(project.manifest.name);
  const find = async () => (await listWorkspaces(ctx.api, organizationId, slug))[0];
  let workspace: Workspace | undefined = await find();
  if (workspace) {
    ctx.ui.info(`Using the existing workspace \`${workspace.slug}\` in organization ${organizationId}.`);
  } else {
    try {
      workspace = await createWorkspace(ctx.api, organizationId, project.manifest.name, slug);
      ctx.ui.success(`Created the workspace \`${workspace.slug}\`.`);
    } catch (error) {
      workspace = isConflict(error) ? await find() : undefined;
      if (!workspace) throw error;
    }
  }
  const binding = { workspaceId: String(workspace.id), organizationId: String(workspace.organization_id), slug: workspace.slug };
  writeBinding(project.root, binding);
  return binding;
}

export class IncomingCommitsRefused extends Error {
  constructor(
    readonly commits: readonly SourceCommit[],
    readonly reason: "declined" | "needs_accept_merged_commits",
  ) {
    super("The source repo has commits this project doesn't.");
  }
}

const COMMITS_SHOWN = 10;

export function namesOf(commits: readonly SourceCommit[]): string {
  const names = new Map<string, string>();
  for (const { author, email } of commits) names.set(email || author, author || email);
  const list = [...names.values()];
  const last = list.pop() ?? "someone";
  return list.length === 0 ? last : `${list.join(", ")} and ${last}`;
}

function incomingLines(commits: readonly SourceCommit[]): string {
  const shown = commits.slice(0, COMMITS_SHOWN).map((commit) => `  ${commit.sha.slice(0, 12)} ${commit.author}: ${commit.subject}`);
  const more = commits.length - shown.length;
  return [
    "The source repo has commits this project doesn't, and this push merges them in:",
    ...shown,
    ...(more > 0 ? [`  and ${more} more`] : []),
    "Their names come from the commits, which whoever pushed them could set.",
  ].join("\n");
}

const confirmIncoming =
  (ctx: CommandContext<"required">, input: PushInput) =>
  async (commits: readonly SourceCommit[]): Promise<void> => {
    if (!ctx.json) ctx.ui.report(incomingLines(commits));
    if (input.acceptMergedCommits) return;
    if (!ctx.interactive) throw new IncomingCommitsRefused(commits, "needs_accept_merged_commits");
    const confirmed = await ctx.ui.confirm({
      message: `Your copy will run commits from ${namesOf(commits)} with your reads. Push anyway?`,
      initial: false,
    });
    if (!confirmed) throw new IncomingCommitsRefused(commits, "declined");
  };

async function signedInAuthor(api: SuperwallApi): Promise<{ name: string; email: string } | undefined> {
  const me = await getMe(api).catch(() => undefined);
  if (!me?.email) return undefined;
  return { name: me.name || me.email, email: me.email };
}

const isTransient = (error: unknown): boolean =>
  error instanceof ApiUnreachableError || (error instanceof ApiError && error.status >= 500);

async function pushAndBuild(
  ctx: CommandContext<"required">,
  root: string,
  binding: WorkspaceBinding,
  files: readonly SourceFile[],
  input: PushInput,
): Promise<{ pushed: DirectPushResult; build: WorkspaceBuild; binding: WorkspaceBinding }> {
  let current = binding;
  const incoming: SourceCommit[] = [];
  const author = await signedInAuthor(ctx.api);
  for (let attempt = 1; ; attempt++) {
    const access = await mintSourceAccess(ctx.api, current.workspaceId);
    const pushed = await pushSourceTree({
      access: toSourceAccess(access),
      base: current.syncedCommit,
      reviewed: current.reviewedCommit,
      overwrite: input.overwriteSource,
      confirmIncoming: confirmIncoming(ctx, input),
      ...(author ? { author } : {}),
      files,
      message: {
        kind: "workspace",
        surface: current.slug,
        workspaceId: current.workspaceId,
        sdk: vendoredVersion(root),
        cli: VERSION,
        note: input.m,
      },
    });
    incoming.push(...(pushed.incoming ?? []));
    current = {
      ...current,
      ...(pushed.syncedTo ? { syncedCommit: pushed.syncedTo } : {}),
      ...(pushed.commitSha ? { reviewedCommit: pushed.commitSha } : {}),
    };
    writeBinding(root, current);
    try {
      const build = await startBuild(ctx.api, current.workspaceId, pushed.commitSha, access.token_id);
      return { pushed: { ...pushed, incoming }, build, binding: current };
    } catch (error) {
      if (attempt >= PUSH_ATTEMPTS || !isConflict(error)) throw error;
      ctx.ui.info("Someone pushed at the same moment. Pushing again on top of them.");
    }
  }
}

export type BuildWait = { finished: true; build: WorkspaceBuild } | { finished: false; build: WorkspaceBuild };

export async function waitForBuild(
  api: SuperwallApi,
  first: WorkspaceBuild,
  seams: PushSeams,
  onProgress: (build: WorkspaceBuild) => void,
): Promise<BuildWait> {
  const wait = seams.sleep ?? sleep;
  const now = seams.now ?? Date.now;
  const deadline = now() + POLL_TIMEOUT_MS;
  let build = first;
  let failures = 0;
  for (;;) {
    await wait(POLL_INTERVAL_MS);
    try {
      build = await getBuild(api, build.workspace_id, build.version_id);
      failures = 0;
    } catch (error) {
      failures += 1;
      if (!isTransient(error) || failures > POLL_FAILURES_ALLOWED) throw error;
    }
    onProgress(build);
    if (build.status === "succeeded" || build.status === "failed") return { finished: true, build };
    if (now() >= deadline) return { finished: false, build };
  }
}

const buildSummary = (workspace: WorkspaceBinding, pushed: DirectPushResult, build: WorkspaceBuild, url: string) => ({
  workspace_id: Number(workspace.workspaceId),
  slug: workspace.slug,
  version_id: build.version_id,
  commit_sha: build.commit_sha,
  source: pushed.status,
  status: build.status,
  step: build.step,
  failure: build.failure,
  steps: build.steps,
  merged_commits: pushed.incoming ?? [],
  url,
});

function refusedPush(ctx: CommandContext<"required">, { commits, reason }: IncomingCommitsRefused): void {
  if (ctx.json) {
    ctx.output.data({ pushed: false, reason, merged_commits: commits });
  } else if (reason === "declined") {
    ctx.ui.outro("Nothing was pushed. Run `superwall workspaces pull` to read them first.");
    return;
  } else {
    ctx.ui.error(
      `Nothing was pushed. Your copy would run commits from ${namesOf(commits)} with your reads. Run \`superwall workspaces pull\` to read them first, or pass --accept-merged-commits.`,
    );
  }
  ctx.fail();
}

export async function runWorkspacePush(
  ctx: CommandContext<"required">,
  input: PushInput,
  seams: PushSeams = {},
): Promise<void> {
  const project = readProject(input.dir);
  await warnIfSdkBehind(ctx.ui, project.root, seams.fetchVersion);
  if (!(await (seams.hasGit ?? gitAvailable)())) {
    throw new WorkspaceError("`superwall workspaces push` uses git to send your source. Install git, then try again.");
  }
  const checked = await collectSourceFiles(project.root, readSourceFile);
  if (!checked.ok) throw new WorkspaceError(checked.reason);

  const linked = await linkedWorkspace(ctx, project, input.org);
  const collected = await collectSourceFiles(project.root, readSourceFile);
  if (!collected.ok) throw new WorkspaceError(collected.reason);
  let result: Awaited<ReturnType<typeof pushAndBuild>>;
  try {
    result = await pushAndBuild(ctx, project.root, linked, collected.files, input);
  } catch (error) {
    if (!(error instanceof IncomingCommitsRefused)) throw error;
    refusedPush(ctx, error);
    return;
  }
  const { pushed, build: started, binding } = result;
  const url = workspaceUrl(ctx.api.host, { organization_id: Number(binding.organizationId), slug: binding.slug });

  const spin = ctx.ui.spinner();
  spin.start(`Building version ${started.version_id}`);
  const finishedAlready = started.status === "succeeded" || started.status === "failed";
  const wait = finishedAlready
    ? await waitForBuild(ctx.api, started, { ...seams, sleep: async () => undefined }, () => {})
    : await waitForBuild(ctx.api, started, seams, (build) => {
        if (build.step) spin.message(`Building version ${build.version_id}: ${build.step}`);
      });
  const { build } = wait;
  const summary = buildSummary(binding, pushed, build, url);

  if (!wait.finished) {
    spin.stop(`Version ${build.version_id} is still building`);
    if (ctx.json) ctx.output.data(summary);
    else ctx.ui.warn("It's taking longer than expected. Check it with `superwall workspaces status`.");
    ctx.fail();
    return;
  }
  if (build.status === "failed") {
    spin.stop(`Version ${build.version_id} didn't build`);
    if (ctx.json) {
      ctx.output.data(summary);
    } else {
      const where = build.step ? ` at ${build.step}` : "";
      ctx.ui.error(`The build failed${where}: ${build.failure?.message ?? "the builder gave no reason."}`);
      ctx.ui.info("See its log with `superwall workspaces logs`.");
    }
    ctx.fail();
    return;
  }

  spin.stop(`Built version ${build.version_id}`);
  if (ctx.json) {
    ctx.output.data(summary);
    return;
  }
  ctx.ui.success(`Only you can see version ${build.version_id} until an admin approves it.`);
  if (pushed.incoming?.length) {
    ctx.ui.warn(
      `It runs commits from ${namesOf(pushed.incoming)} with your reads, and they aren't in this project yet. Run \`superwall workspaces pull\` to get them.`,
    );
  }
  ctx.ui.info(`Open ${url}`);
  ctx.ui.info("To ask for review, run `superwall workspaces share`.");
}
