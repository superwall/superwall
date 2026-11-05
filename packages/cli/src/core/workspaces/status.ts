import type { CommandContext } from "@/program/command";
import { ApiError } from "@/core/api/client";
import { getBuild, getMe, listMembers, listVersions, requestDeploy, type OrganizationMember, type Workspace, type WorkspaceBuild, type WorkspaceVersion } from "./api";
import { WorkspaceError } from "./project";
import { awaitingInstall, latestManifest, newestFirst, openLink, pickVersion, roleCanApprove, resolveWorkspace, visibilityOf, type WorkspaceRef } from "./resolve";

const SHOWN_VERSIONS = 3;

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

export interface StatusInput extends WorkspaceRef {
  all?: boolean;
}

export async function runWorkspaceStatus(ctx: CommandContext<"required">, input: StatusInput): Promise<void> {
  const workspace = await resolveWorkspace(ctx, input);
  let versions = newestFirst(await listVersions(ctx.api, workspace.id));
  const [latest] = versions;
  const build = latest && isUnfinished(latest) ? await settle(ctx, latest) : undefined;
  if (build) versions = versions.map((version) => (version.id === build.version.id ? build.version : version));

  const { url } = await openLink(ctx, workspace, latestManifest(versions));
  const live = versions.find((version) => version.id === workspace.active_version_id);
  const notInstalled = workspace.state === "active" && (await awaitingInstall(ctx.api, workspace.id, live?.manifest));
  if (ctx.json) {
    ctx.output.data({ workspace, url, versions, build: build ?? null, awaiting_install: notInstalled });
    return;
  }
  const label = notInstalled ? "Approved, but nothing is installed yet, so only its author can see it" : STATE_LABEL[workspace.state];
  ctx.ui.success(`${workspace.name} (\`${workspace.slug}\`, id ${workspace.id}): ${label}`);
  ctx.ui.info(`Open ${url}`);
  const newest = input.all ? versions : versions.slice(0, SHOWN_VERSIONS);
  const shown = live && !newest.includes(live) ? [...newest, live] : newest;
  ctx.ui.list({
    empty: "No versions yet. Run `superwall workspaces push`.",
    items: shown.map((version) => ({
      label: `Version ${version.id}`,
      meta: versionMeta(version, workspace.active_version_id, workspace.author_version_id),
    })),
  });
  const hidden = versions.length - shown.length;
  if (hidden > 0) ctx.ui.info(`And ${hidden} older ${hidden === 1 ? "version" : "versions"}. See them all with --all.`);
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

const NAMES_SHOWN = 5;

const canApprove = (member: OrganizationMember): boolean =>
  member.status === "active" && (member.role === "OWNER" || member.role === "ADMIN") && member.project_access_mode !== "RESTRICTED";

async function approvers(ctx: CommandContext<"required">, workspace: Workspace): Promise<{ admin: boolean; names: string[] }> {
  const [members, me] = await Promise.all([
    listMembers(ctx.api, workspace.organization_id).catch(() => []),
    getMe(ctx.api).catch(() => undefined),
  ]);
  const mine = me?.email ? members.find((member) => member.email === me.email) : undefined;
  const admin = mine ? canApprove(mine) : await roleCanApprove(ctx, workspace);
  const names = members
    .filter(canApprove)
    .map((member) => member.name || member.email)
    .filter((name): name is string => Boolean(name));
  return { admin, names: admin ? [] : names };
}

function askLine(names: readonly string[]): string {
  if (names.length === 0) return "Ask an organization owner or admin to approve it.";
  const shown = names.slice(0, NAMES_SHOWN).join(", ");
  const more = names.length > NAMES_SHOWN ? ` or ${names.length - NAMES_SHOWN} more` : "";
  return `Ask one of the people who can approve it: ${shown}${more}.`;
}

export async function runWorkspaceShare(ctx: CommandContext<"required">, input: ShareInput): Promise<void> {
  const workspace = await resolveWorkspace(ctx, input);
  const { version } = await pickVersion(ctx, workspace, input.version, (candidate) => candidate.build_status === "SUCCEEDED");
  if (version.id === workspace.active_version_id) {
    throw new WorkspaceError(`Version ${version.id} is already live. Push a new version to ask for review.`);
  }
  const requested = await requestDeploy(ctx.api, workspace.id, version.id);
  const { admin, names } = await approvers(ctx, workspace);
  const { visibleTo, sentence } = await visibilityOf(ctx, workspace.id, version.id, version.manifest);
  if (ctx.json) {
    ctx.output.data({ ...requested, can_approve: admin, approvers: names, visible_to: visibleTo });
    return;
  }
  ctx.ui.success(`Version ${version.id} is marked for review. ${sentence}`);
  if (!admin) ctx.ui.info(`Nobody is told automatically. ${askLine(names)}`);
  ctx.ui.info(`An admin approves it with \`superwall workspaces approve ${version.id} --workspace ${workspace.id}\`.`);
}
