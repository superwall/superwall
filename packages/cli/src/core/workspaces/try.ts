import type { CommandContext } from "@/program/command";
import { openBrowser } from "@/core/account/browser";
import { ApiError } from "@/core/api/client";
import { DASHBOARD_ORIGIN_OVERRIDE } from "@/environment";
import { bundleWorkspace, type RunWrangler } from "./bundle";
import { resolveAppScope, resolveOrganization } from "./organization";
import { findEntrypoint, readProject, WorkspaceError, type Entrypoint, type WorkspaceProject } from "./project";
import { warnIfSdkBehind } from "./sdk";
import { parseFilters, summarizeSeries, type MetricSeries } from "./series";
import { defaultRange } from "./slots";
import { DRAFT_MODULE_MAX_BYTES } from "./wire";

export interface TryInput {
  entrypoint: string;
  dir?: string;
  app?: string;
  org?: string;
  from?: string;
  to?: string;
  days: number;
  interval: string;
  breakdown?: string;
  filter: readonly string[];
  points: boolean;
  campaign?: string;
  user?: string;
  environment?: string;
  open: boolean;
}

export interface TrySeams {
  wrangler?: RunWrangler;
  open?: (url: string) => Promise<boolean>;
}

interface Draft {
  id: string;
  requested_scopes: readonly string[];
  expires_at: string;
}

async function postDraft<T>(ctx: CommandContext<"required">, path: string, body: unknown): Promise<T> {
  try {
    return await ctx.api.post<T>(path, body);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) throw new WorkspaceError(error.message);
    throw error;
  }
}

async function uploadDraft(
  ctx: CommandContext<"required">,
  project: WorkspaceProject,
  organizationId: string,
  wrangler: RunWrangler | undefined,
): Promise<Draft> {
  const { module, bytes } = await bundleWorkspace(project.root, wrangler);
  if (bytes > DRAFT_MODULE_MAX_BYTES) {
    throw new WorkspaceError(`The bundle is ${bytes} bytes; a draft can be ${DRAFT_MODULE_MAX_BYTES} at most.`);
  }
  return postDraft<Draft>(ctx, "/v2/workspaces/drafts", {
    organization_id: Number(organizationId),
    manifest: project.manifest,
    module,
  });
}

async function tryMetric(
  ctx: CommandContext<"required">,
  project: WorkspaceProject,
  entrypoint: Entrypoint,
  input: TryInput,
  wrangler: RunWrangler | undefined,
): Promise<void> {
  if (input.app === undefined) {
    throw new WorkspaceError("A metric runs for one app. Say which with --app <id>.");
  }
  const { organizationId, applicationId } = await resolveAppScope(ctx.api, input.app, input.org);
  if (organizationId === undefined) {
    throw new WorkspaceError(`Couldn't find the organization of app ${input.app}. Say which with --org <id>.`);
  }
  const range = defaultRange(input.days);
  const filters = parseFilters(input.filter);
  const draft = await uploadDraft(ctx, project, organizationId, wrangler);
  const run = await postDraft<{ series: MetricSeries }>(
    ctx,
    `/v2/workspaces/drafts/${encodeURIComponent(draft.id)}/metric`,
    {
      organization_id: Number(organizationId),
      application_id: Number(applicationId),
      entrypoint_id: entrypoint.id,
      from: input.from ?? range.from,
      to: input.to ?? range.to,
      interval: input.interval,
      ...(input.breakdown === undefined ? {} : { breakdown: input.breakdown }),
      ...(input.filter.length === 0 ? {} : { filters }),
    },
  );

  const summary = summarizeSeries(run.series);
  if (ctx.json) {
    ctx.output.data({
      draft_id: draft.id,
      expires_at: draft.expires_at,
      requested_scopes: draft.requested_scopes,
      entrypoint_id: entrypoint.id,
      summary,
      series: run.series,
    });
    return;
  }
  ctx.ui.success(`Ran \`${entrypoint.id}\` on the real runtime, as you. Only you can reach this draft, until ${draft.expires_at}.`);
  ctx.ui.list({
    empty: "It returned no points.",
    items: summary.map((series) => ({
      label: series.name,
      meta: `${series.points} points, sum ${round(series.sum)}, latest ${round(series.last)} at ${series.lastAt}`,
    })),
  });
  if (input.points) {
    ctx.ui.list({
      items: run.series.points.map((point) => ({
        label: point.t,
        meta: `${point.breakdown ?? ""} ${round(point.value)}`.trim(),
      })),
    });
  }
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

export function dashboardOrigin(apiHost: string): string {
  return DASHBOARD_ORIGIN_OVERRIDE() ?? (new URL(apiHost).hostname.endsWith(".dev") ? "https://app.superwall.dev" : "https://app.superwall.com");
}

async function tryFrame(
  ctx: CommandContext<"required">,
  project: WorkspaceProject,
  entrypoint: Entrypoint,
  input: TryInput,
  seams: TrySeams,
): Promise<void> {
  const scope =
    input.app === undefined
      ? { organizationId: await resolveOrganization(ctx, input.org) }
      : await resolveAppScope(ctx.api, input.app, input.org);
  if (scope.organizationId === undefined) {
    throw new WorkspaceError(`Couldn't find the organization of app ${input.app}. Say which with --org <id>.`);
  }
  const draft = await uploadDraft(ctx, project, scope.organizationId, seams.wrangler);
  const search = new URLSearchParams({ entrypoint: entrypoint.id });
  if (scope.applicationId !== undefined) search.set("app", scope.applicationId);
  if (input.campaign !== undefined) search.set("campaign", input.campaign);
  if (input.user !== undefined) search.set("user", input.user);
  if (input.environment !== undefined) search.set("environment", input.environment);
  const url = `${dashboardOrigin(ctx.api.host)}/${scope.organizationId}/workspace-drafts/${draft.id}?${search}`;

  if (ctx.json) {
    ctx.output.data({
      draft_id: draft.id,
      expires_at: draft.expires_at,
      requested_scopes: draft.requested_scopes,
      entrypoint_id: entrypoint.id,
      url,
    });
    return;
  }
  ctx.ui.success(`Uploaded a draft of \`${entrypoint.id}\`. It runs as you, and only you can reach it, until ${draft.expires_at}.`);
  ctx.ui.info(`Open ${url}`);
  if (input.open && ctx.outputMode === "rich") await (seams.open ?? openBrowser)(url);
}

function tryReadout(entrypoint: Entrypoint): never {
  throw new WorkspaceError(
    `\`${entrypoint.id}\` (${entrypoint.slot}) is a readout, and readouts can't be tried on the real runtime yet. Run \`superwall workspaces dev\` to run it locally.`,
  );
}

export async function runWorkspaceTry(
  ctx: CommandContext<"required">,
  input: TryInput,
  seams: TrySeams = {},
): Promise<void> {
  const project = readProject(input.dir);
  const entrypoint = findEntrypoint(project.manifest, input.entrypoint);
  await warnIfSdkBehind(ctx.ui, project.root);
  if (entrypoint.slot === "chart.source@1") return tryMetric(ctx, project, entrypoint, input, seams.wrangler);
  if (entrypoint.slot === "campaign.metric@1") return tryReadout(entrypoint);
  return tryFrame(ctx, project, entrypoint, input, seams);
}
