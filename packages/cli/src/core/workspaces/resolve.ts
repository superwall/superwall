import * as path from "node:path";
import type { CommandContext } from "@/program/command";
import { DASHBOARD_ORIGIN_OVERRIDE } from "@/environment";
import { getWorkspace, listVersions, listWorkspaces, type Workspace, type WorkspaceVersion } from "./api";
import { readBinding } from "./binding";
import { WorkspaceError } from "./project";

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
