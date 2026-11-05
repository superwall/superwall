import type { CommandContext } from "@/program/command";
import { openBrowser } from "@/core/account/browser";
import {
  deleteInstallation,
  listInstallations,
  listVersions,
  listWorkspaces,
  setInstallation,
  type WorkspaceInstallation,
} from "./api";
import { readBinding } from "./binding";
import { resolveAppScope, resolveOrganization } from "./organization";
import { WorkspaceError } from "./project";
import { appEntrypointUrl, latestManifest, openLink, projectRoot, resolveWorkspace, type WorkspaceRef } from "./resolve";

export interface InstallInput extends WorkspaceRef {
  entrypoint?: string;
  app?: string;
  disable: boolean;
  remove: boolean;
  position?: number;
  yes: boolean;
}

const whereLabel = (application: number | string | null | undefined) =>
  application === null || application === undefined ? "the whole organization" : `app ${application}`;

const installationItem = (installation: WorkspaceInstallation) => ({
  label: installation.entrypoint_id,
  meta: [
    installation.slot,
    whereLabel(installation.application_id),
    installation.enabled ? "on" : "off",
    `position ${installation.position}`,
  ].join(", "),
});

export async function runWorkspaceInstall(ctx: CommandContext<"required">, input: InstallInput): Promise<void> {
  const workspace = await resolveWorkspace(ctx, input);
  if (input.entrypoint === undefined) {
    if (input.remove || input.disable || input.app !== undefined || input.position !== undefined) {
      throw new WorkspaceError("Say which entrypoint: `superwall workspaces install <entrypoint>`.");
    }
    const installations = await listInstallations(ctx.api, workspace.id);
    if (ctx.json) ctx.output.data({ data: installations });
    else ctx.ui.list({ empty: "Nothing is installed yet.", items: installations.map(installationItem) });
    return;
  }

  const applicationId =
    input.app === undefined
      ? undefined
      : (await resolveAppScope(ctx.api, input.app, String(workspace.organization_id))).applicationId;

  if (input.remove) {
    if (!input.yes) {
      if (!ctx.interactive) {
        throw new WorkspaceError("Removing an installation ends sessions that are open. Pass --yes to go ahead.");
      }
      const confirmed = await ctx.ui.confirm({
        message: `Remove \`${input.entrypoint}\` from ${whereLabel(applicationId)}? Sessions that are open will end.`,
        initial: false,
      });
      if (!confirmed) {
        ctx.ui.outro("Nothing was removed.");
        return;
      }
    }
    const left = await deleteInstallation(ctx.api, workspace.id, input.entrypoint, applicationId);
    if (ctx.json) ctx.output.data(left);
    else ctx.ui.success(`Removed \`${input.entrypoint}\` from ${whereLabel(applicationId)}.`);
    return;
  }

  const installation = await setInstallation(ctx.api, workspace.id, {
    entrypoint_id: input.entrypoint,
    application_id: applicationId === undefined ? null : Number(applicationId),
    enabled: !input.disable,
    ...(input.position === undefined ? {} : { position: input.position }),
  });
  if (ctx.json) {
    ctx.output.data(installation);
    return;
  }
  ctx.ui.success(
    input.disable
      ? `Turned \`${input.entrypoint}\` off for ${whereLabel(applicationId)}.`
      : `Installed \`${input.entrypoint}\` for ${whereLabel(applicationId)}.`,
  );
}

export interface ListInput {
  dir?: string;
  org?: string;
}

export async function runWorkspaceList(ctx: CommandContext<"required">, input: ListInput): Promise<void> {
  const organizationId = await resolveOrganization(ctx, input.org ?? readBinding(projectRoot(input.dir))?.organizationId);
  const workspaces = await listWorkspaces(ctx.api, organizationId);
  if (ctx.json) {
    ctx.output.data({ data: workspaces });
    return;
  }
  ctx.ui.list({
    empty: `No workspaces in organization ${organizationId} yet.`,
    items: workspaces.map((workspace) => ({
      label: workspace.name,
      meta: `${workspace.slug}, id ${workspace.id}, ${workspace.state.replaceAll("_", " ")}`,
    })),
  });
}

export interface OpenInput extends WorkspaceRef {
  entrypoint?: string;
  app?: string;
  open: boolean;
}

export interface OpenSeams {
  open?: (url: string) => Promise<boolean>;
}

export async function runWorkspaceOpen(
  ctx: CommandContext<"required">,
  input: OpenInput,
  seams: OpenSeams = {},
): Promise<void> {
  const workspace = await resolveWorkspace(ctx, input);
  if (input.entrypoint !== undefined && input.app === undefined) {
    throw new WorkspaceError("An entrypoint opens inside an app. Say which with --app <id>.");
  }
  const manifest = latestManifest(await listVersions(ctx.api, workspace.id).catch(() => []));
  let url: string;
  if (input.entrypoint !== undefined && input.app !== undefined) {
    const { applicationId } = await resolveAppScope(ctx.api, input.app, String(workspace.organization_id));
    const entrypoint = manifest?.entrypoints.find((candidate) => candidate.id === input.entrypoint);
    url = appEntrypointUrl(ctx.api.host, workspace, String(applicationId), entrypoint ?? { id: input.entrypoint, slot: "app.page@1", title: "" });
  } else {
    url = (await openLink(ctx, workspace, manifest)).url;
  }
  if (ctx.json) {
    ctx.output.data({ url });
    return;
  }
  ctx.ui.info(`Open ${url}`);
  if (input.open && ctx.outputMode === "rich") await (seams.open ?? openBrowser)(url);
}
