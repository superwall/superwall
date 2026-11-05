import type { CommandContext } from "@/program/command";
import type { SuperwallApi } from "@/core/api/client";
import { appNotFound, findApplication } from "@/core/api/lookup";
import { listOrganizations, orgIdOf, orgProjects } from "@/core/api/orgs";
import { apiCall } from "@/ui/spinner";
import { WorkspaceError } from "./project";

export interface Scope {
  organizationId?: string;
  applicationId?: string;
}

export async function resolveAppScope(api: SuperwallApi, app: string, org?: string): Promise<Scope> {
  if (/^\d+$/.test(app) && org !== undefined) return { organizationId: org, applicationId: app };
  const found = await findApplication(api, app, org === undefined ? undefined : await orgProjects(api, org));
  if (!found) throw appNotFound(app);
  const home = orgIdOf(found.project);
  if (org !== undefined && home !== org) {
    throw new WorkspaceError(`App ${app} is in organization ${home ?? "unknown"}, not ${org}.`);
  }
  return { organizationId: org ?? home, applicationId: String(found.app.id) };
}

export async function resolveOrganization(
  ctx: CommandContext<"required">,
  org: string | undefined,
): Promise<string> {
  if (org !== undefined) return org;
  const organizations = await apiCall(ctx, "Loading your organizations", () => listOrganizations(ctx.api));
  const [only] = organizations;
  if (only !== undefined && organizations.length === 1) return String(only.id);
  if (!ctx.interactive || organizations.length === 0) {
    throw new WorkspaceError("Say which organization with --org <id>.");
  }
  const picked = await ctx.ui.select({
    message: "Which organization?",
    options: organizations.map((organization) => ({
      value: String(organization.id),
      label: String(organization.name ?? organization.id),
    })),
  });
  if (picked === null) throw new WorkspaceError("No organization picked.");
  return picked;
}
