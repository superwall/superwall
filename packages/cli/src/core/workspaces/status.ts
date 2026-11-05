import type { CommandContext } from "@/program/command";
import { ApiError } from "@/core/api/client";
import { getBuild, listVersions, requestDeploy, type WorkspaceBuild, type WorkspaceVersion } from "./api";
import { WorkspaceError } from "./project";
import { newestFirst, pickVersion, resolveWorkspace, workspaceUrl, type WorkspaceRef } from "./resolve";

const SHOWN_VERSIONS = 5;

const STATE_LABEL = {
  active: "Live",
  no_version: "Nothing pushed yet",
  not_approved: "Waiting for an admin to approve a version",
  turned_off: "Turned off",
} as const;

const versionMeta = (version: WorkspaceVersion, activeId: number | null, authorId: number | null | undefined) =>
  [
    version.commit_sha.slice(0, 12),
    version.build_status.toLowerCase(),
    version.id === activeId ? "active" : undefined,
    version.id === authorId ? "yours until approved" : undefined,
    version.deploy_requested_at && version.id !== activeId ? "review requested" : undefined,
  ]
    .filter(Boolean)
    .join(", ");

const isUnfinished = (version: WorkspaceVersion) => version.build_status === "PENDING" || version.build_status === "BUILDING";

async function settle(ctx: CommandContext<"required">, version: WorkspaceVersion): Promise<WorkspaceBuild | undefined> {
  try {
    return await getBuild(ctx.api, version.workspace_id, version.id);
  } catch (error) {
    if (error instanceof ApiError && [403, 404, 503].includes(error.status)) return undefined;
    throw error;
  }
}

export async function runWorkspaceStatus(ctx: CommandContext<"required">, input: WorkspaceRef): Promise<void> {
  const workspace = await resolveWorkspace(ctx, input);
  let versions = newestFirst(await listVersions(ctx.api, workspace.id));
  const [latest] = versions;
  const build = latest && isUnfinished(latest) ? await settle(ctx, latest) : undefined;
  if (build) versions = versions.map((version) => (version.id === build.version.id ? build.version : version));

  const url = workspaceUrl(ctx.api.host, workspace);
  if (ctx.json) {
    ctx.output.data({ workspace, url, versions, build: build ?? null });
    return;
  }
  ctx.ui.success(`${workspace.name} (\`${workspace.slug}\`, id ${workspace.id}): ${STATE_LABEL[workspace.state]}`);
  ctx.ui.info(`Open ${url}`);
  ctx.ui.list({
    empty: "No versions yet. Run `superwall workspaces push`.",
    items: versions.slice(0, SHOWN_VERSIONS).map((version) => ({
      label: `Version ${version.id}`,
      meta: versionMeta(version, workspace.active_version_id, workspace.author_version_id),
    })),
  });
  if (build?.step) ctx.ui.info(`Version ${build.version_id} is at ${build.step}.`);
  const failed = versions.find((version) => version.build_status === "FAILED" && version.id === latest?.id);
  if (failed) ctx.ui.warn(`Version ${failed.id} didn't build: ${failed.build_error ?? "see `superwall workspaces logs`."}`);
}

export interface LogsInput extends WorkspaceRef {
  version?: string;
}

export async function runWorkspaceLogs(ctx: CommandContext<"required">, input: LogsInput): Promise<void> {
  const workspace = await resolveWorkspace(ctx, input);
  const { version } = await pickVersion(ctx, workspace, input.version);
  const build = await getBuild(ctx.api, workspace.id, version.id);
  if (ctx.json) {
    ctx.output.data({
      version_id: build.version_id,
      status: build.status,
      step: build.step,
      failure: build.failure,
      steps: build.steps,
      log: build.log,
    });
    return;
  }
  if (build.status === "queued" || build.status === "running") {
    ctx.ui.info(`Version ${build.version_id} is still building${build.step ? `, at ${build.step}` : ""}. Its log appears once it finishes.`);
    return;
  }
  if (build.failure) ctx.ui.error(`The build failed: ${build.failure.message}`);
  if (build.log === null || build.log === "") {
    ctx.ui.info(`Version ${build.version_id} has no build log.`);
    return;
  }
  ctx.output.text(build.log);
}

export interface ShareInput extends WorkspaceRef {
  version?: string;
}

export async function runWorkspaceShare(ctx: CommandContext<"required">, input: ShareInput): Promise<void> {
  const workspace = await resolveWorkspace(ctx, input);
  const { version } = await pickVersion(ctx, workspace, input.version, (candidate) => candidate.build_status === "SUCCEEDED");
  if (version.id === workspace.active_version_id) {
    throw new WorkspaceError(`Version ${version.id} is already live. Push a new version to ask for review.`);
  }
  const requested = await requestDeploy(ctx.api, workspace.id, version.id);
  if (ctx.json) {
    ctx.output.data(requested);
    return;
  }
  ctx.ui.success(`Asked for review of version ${version.id}. Only you can see it until an admin approves it.`);
  ctx.ui.info(`An admin approves it with \`superwall workspaces approve ${version.id} --workspace ${workspace.id}\`.`);
}
