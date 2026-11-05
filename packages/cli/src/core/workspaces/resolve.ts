import * as path from "node:path";
import type { CommandContext } from "@/program/command";
import type { SuperwallApi } from "@/core/api/client";
import { DASHBOARD_ORIGIN_OVERRIDE } from "@/environment";
import { listOrganizations, orgProjects } from "@/core/api/orgs";
import { getMe, getWorkspace, listInstallations, listVersions, listWorkspaces, type Workspace, type WorkspaceVersion } from "./api";
import { readBinding } from "./binding";
import { WorkspaceError, type Entrypoint, type Manifest } from "./project";

export interface WorkspaceRef {
  dir?: string;
  workspace?: string;
  org?: string;
}

export const projectRoot = (dir: string | undefined): string => path.resolve(dir ?? process.cwd());

export async function resolveWorkspace(ctx: CommandContext<"required">, ref: WorkspaceRef): Promise<Workspace> {
  if (ref.workspace !== undefined) {
    if (/^\d+$/.test(ref.workspace)) return getWorkspace(ctx.api, ref.workspace);
    if (ref.org === undefined) {
      throw new WorkspaceError(`A slug needs its organization: add --org <id>, or pass the workspace's id.`);
    }
    const [found] = await listWorkspaces(ctx.api, ref.org, ref.workspace);
    if (!found) throw new WorkspaceError(`No workspace \`${ref.workspace}\` in organization ${ref.org}.`);
    return found;
  }
  const binding = readBinding(projectRoot(ref.dir));
  if (!binding) {
    throw new WorkspaceError(
      "This project isn't linked to a workspace yet. Run `superwall workspaces push`, or say which with --workspace <id>.",
    );
  }
  return getWorkspace(ctx.api, binding.workspaceId);
}

export function dashboardOrigin(apiHost: string): string {
  return (
    DASHBOARD_ORIGIN_OVERRIDE() ??
    (new URL(apiHost).hostname.endsWith(".dev") ? "https://app.superwall.dev" : "https://app.superwall.com")
  );
}

export const workspaceUrl = (apiHost: string, workspace: Pick<Workspace, "organization_id" | "slug">): string =>
  `${dashboardOrigin(apiHost)}/${workspace.organization_id}/workspaces/${encodeURIComponent(workspace.slug)}`;

const EMBED_SLOTS: ReadonlySet<string> = new Set([
  "app.dashboard.widget@1",
  "campaign.tab@1",
  "campaign.metric@1",
  "user.panel@1",
  "user.action@1",
]);

type Linked = Pick<Workspace, "id" | "organization_id" | "slug">;

export const appEntrypointUrl = (apiHost: string, workspace: Linked, applicationId: string, entrypoint: Entrypoint): string => {
  const app = `${dashboardOrigin(apiHost)}/${workspace.organization_id}/${applicationId}`;
  if (entrypoint.slot === "chart.source@1") return `${app}/charts?cS=workspaces`;
  if (EMBED_SLOTS.has(entrypoint.slot)) return `${app}/embeds`;
  return `${app}/apps/${workspace.id}/${encodeURIComponent(entrypoint.id)}`;
};

export interface OpenLink {
  url: string;
  app?: string;
  otherApps?: boolean;
}

const mainEntrypoint = (entrypoints: readonly Entrypoint[]): Entrypoint | undefined =>
  entrypoints.find((entrypoint) => entrypoint.slot === "app.page@1") ??
  entrypoints.find((entrypoint) => EMBED_SLOTS.has(entrypoint.slot)) ??
  entrypoints.find((entrypoint) => entrypoint.slot === "chart.source@1");

export async function openLink(
  ctx: CommandContext<"required">,
  workspace: Linked,
  manifest: Pick<Manifest, "entrypoints"> | null | undefined,
): Promise<OpenLink> {
  const fallback = { url: workspaceUrl(ctx.api.host, workspace) };
  const entrypoints = manifest?.entrypoints ?? [];
  const main = mainEntrypoint(entrypoints);
  if (!main || entrypoints.some((entrypoint) => entrypoint.slot === "org.page@1")) return fallback;
  const projects = await orgProjects(ctx.api, String(workspace.organization_id)).catch(() => []);
  const apps = projects.flatMap((project) => project.applications ?? []);
  const [first] = apps;
  if (first === undefined) return fallback;
  return {
    url: appEntrypointUrl(ctx.api.host, workspace, String(first.id), main),
    app: String(first.name ?? first.id),
    otherApps: apps.length > 1,
  };
}

export async function awaitingInstall(
  api: SuperwallApi,
  workspaceId: string | number,
  manifest: Pick<Manifest, "entrypoints"> | null | undefined,
): Promise<boolean> {
  const entrypoints = manifest?.entrypoints ?? [];
  if (entrypoints.length === 0 || entrypoints.some((entrypoint) => entrypoint.slot === "org.page@1")) return false;
  const installed = await listInstallations(api, workspaceId).catch(() => undefined);
  if (installed === undefined) return false;
  return entrypoints.every((entrypoint) => !installed.some((row) => row.entrypoint_id === entrypoint.id));
}

export const latestManifest = (versions: readonly WorkspaceVersion[]): Manifest | null | undefined =>
  newestFirst(versions).find((version) => version.manifest !== null)?.manifest;

export type VisibleTo = "everyone" | "you" | "its_author" | "nobody";

export async function visibilityOf(
  ctx: CommandContext<"required">,
  workspaceId: string | number,
  version: number,
  manifest: Pick<Manifest, "entrypoints"> | null | undefined,
): Promise<{ visibleTo: VisibleTo; sentence: string }> {
  const [workspace, me] = await Promise.all([
    getWorkspace(ctx.api, workspaceId).catch(() => undefined),
    getMe(ctx.api).catch(() => undefined),
  ]);
  if (workspace?.state === "turned_off") {
    return { visibleTo: "nobody", sentence: `This workspace is turned off, so nobody can see version ${version}.` };
  }
  if (workspace?.active_version_id === version) {
    if (await awaitingInstall(ctx.api, workspaceId, manifest)) {
      return {
        visibleTo: "its_author",
        sentence: `Version ${version} is approved, but nothing is installed yet, so only its author can see it, marked "Not installed". An admin chooses where it shows with \`superwall workspaces install\`.`,
      };
    }
    return { visibleTo: "everyone", sentence: `Version ${version} is live.` };
  }
  if (workspace?.author_version_id === version) {
    return { visibleTo: "you", sentence: `Only you can see version ${version} until an admin approves it.` };
  }
  if (me?.role === "SUPERADMIN") {
    return {
      visibleTo: "nobody",
      sentence: `Nobody can see version ${version} until an admin approves it, because a staff account doesn't get a copy of its own.`,
    };
  }
  return { visibleTo: "its_author", sentence: `Only its author can see version ${version} until an admin approves it.` };
}

export async function roleCanApprove(ctx: CommandContext<"required">, workspace: Pick<Workspace, "organization_id">): Promise<boolean> {
  const organizations = await listOrganizations(ctx.api).catch(() => []);
  const role = organizations.find((organization) => String(organization.id) === String(workspace.organization_id))?.role;
  return typeof role !== "string" || role === "OWNER" || role === "ADMIN";
}

export const newestFirst = (versions: readonly WorkspaceVersion[]): WorkspaceVersion[] =>
  [...versions].sort((a, b) => b.id - a.id);

export async function pickVersion(
  ctx: CommandContext<"required">,
  workspace: Workspace,
  requested: string | undefined,
  matches: (version: WorkspaceVersion) => boolean = () => true,
): Promise<{ version: WorkspaceVersion; versions: WorkspaceVersion[] }> {
  const versions = newestFirst(await listVersions(ctx.api, workspace.id));
  if (requested !== undefined) {
    const version = versions.find((candidate) => String(candidate.id) === requested);
    if (!version) throw new WorkspaceError(`No version ${requested} of \`${workspace.slug}\`.`);
    return { version, versions };
  }
  const version = versions.find(matches);
  if (!version) throw new WorkspaceError(`\`${workspace.slug}\` has no version for this yet. Run \`superwall workspaces push\`.`);
  return { version, versions };
}
