import pc from "picocolors";
import type { CommandContext } from "@/program/command";
import { pickScope } from "@/core/account/scope";
import { findAppNotificationUrl } from "@/core/app-store-connect/api/client";
import {
  type BundleIdSuggestions,
  checkServerNotifications,
  listBundleIdSuggestions,
  findIntegrations,
  REVENUE_INTEGRATIONS,
  type IntegrationsOverview,
  type SavedAppKey,
  type ServerNotifications,
} from "@/core/api/integrations";
import { appNotFound, findApplication } from "@/core/api/lookup";
import { orgIdOf } from "@/core/api/orgs";
import { platformLabel, type Row } from "@/core/api/resources";
import { describeNotificationUrl } from "@/core/app-store-connect/notification-url";
import { apiCall } from "@/ui/spinner";

type App = Record<string, unknown> & { id: string | number };

interface AppView {
  app: App;
  project: { id: string; name?: string };
  organization: { id?: string; name?: string };
  integrations?: IntegrationsOverview;
  server_notifications?: ServerNotifications;
  notification_url?: string;
  sdk?: BundleIdSuggestions;
}

const quietly = <T>(work: Promise<T>): Promise<T | undefined> => work.catch(() => undefined);

async function findAppView(ctx: CommandContext<"required">, ref: string | undefined): Promise<AppView> {
  const { api } = ctx;
  let found;
  if (ref) {
    found = await apiCall(ctx, "Finding the app", () => findApplication(api, ref));
    if (!found) throw appNotFound(ref);
  } else {
    const scope = await pickScope(ctx, api, true);
    const { applicationId } = scope;
    if (!applicationId) throw new Error(`${scope.projectName ?? scope.projectId} has no apps yet.`);
    found = await findApplication(api, applicationId);
    if (!found) throw appNotFound(applicationId);
  }
  const { project } = found;
  const app: App = { ...found.app };
  const applicationId = String(app.id);
  const orgId = orgIdOf(project);
  const platform = String(app.platform).toLowerCase();
  const appRef = { projectId: String(project.id), applicationId };

  const [integrations, organization, sdk] = await apiCall(ctx, "Loading its setup", () => {
    return Promise.all([
      quietly(findIntegrations(api, applicationId)),
      orgId && quietly(api.get<Row>(`/v2/organizations/${encodeURIComponent(orgId)}`)),
      (platform === "ios" || platform === "android") && quietly(listBundleIdSuggestions(api, applicationId)),
    ]);
  });

  let server_notifications: ServerNotifications | undefined;
  let notification_url: string | undefined;
  if (platform === "ios" && integrations?.app_store_connect_configuration) {
    server_notifications = await apiCall(ctx, "Asking Apple about its notification URL", () => {
      return quietly(checkServerNotifications(api, appRef));
    });
    notification_url = await quietly(findAppNotificationUrl(api, appRef));
  }

  return {
    app,
    project: { id: String(project.id), name: project.name },
    organization: { id: orgId, name: organization && typeof organization.name === "string" ? organization.name : undefined },
    ...(integrations ? { integrations } : {}),
    ...(server_notifications ? { server_notifications } : {}),
    ...(notification_url ? { notification_url } : {}),
    ...(sdk && sdk.available ? { sdk } : {}),
  };
}

const ok = (text: string) => `${pc.green("✓")} ${text}`;
const missing = (text: string, fix?: string) =>
  `${pc.red("✗")} ${text}${fix ? `   ${pc.dim(fix)}` : ""}`;
const value = (field: unknown): string =>
  field === null || field === undefined || field === "" ? pc.dim("—") : String(field);

function section(title: string, rows: [string, string][]): string[] {
  const shown = rows.filter(([, text]) => text !== "");
  if (shown.length === 0) return [];
  const width = Math.max(...shown.map(([label]) => label.length)) + 3;
  return ["", pc.bold(title), ...shown.map(([label, text]) => `  ${label.padEnd(width)}${text}`)];
}

function keyLine(key: SavedAppKey | null | undefined, fix: string): string {
  if (!key) return missing("not saved", fix);
  const bundle = key.bundle_id ? pc.dim(`  ${key.bundle_id}`) : "";
  return key.has_private_key ? ok(`${key.key_id}${bundle}`) : missing(`${key.key_id}, no private key`, fix);
}

function notificationLine(view: AppView, fix: string): string {
  const outcome = view.server_notifications;
  if (!view.integrations?.app_store_connect_configuration) return missing("unknown until an API key is saved", fix);
  if (!outcome) return pc.dim("not checked: this Superwall API can't ask Apple yet");
  if (outcome.status === "already_set" || outcome.status === "set") return ok("Apple sends to Superwall");
  if (outcome.status === "not_set") return missing("not set at Apple", `superwall asc notification-url set --app ${view.app.id}`);
  return missing(describeNotificationUrl(outcome));
}

function revenueLine(overview: IntegrationsOverview | undefined): string {
  if (!overview) return pc.dim("unknown");
  if (!overview.revenue_provider) return pc.dim("none chosen: every source is counted");
  const events = overview.revenue_provider_events;
  const counted = events?.[overview.revenue_provider];
  const seen = events && counted ? pc.dim(`  ${counted.events} events in ${events.window_days} days`) : "";
  const integrations = pc.dim(`  counts ${REVENUE_INTEGRATIONS[overview.revenue_provider].join(", ")}`);
  return `${overview.revenue_provider}${seen}${integrations}`;
}

function sdkRows(sdk: BundleIdSuggestions, saved: unknown): [string, string][] {
  if (sdk.candidates.length === 0) return [["Reported", pc.dim("nothing: no build has run the SDK")]];
  return sdk.candidates.map((candidate) => {
    const matches =
      typeof saved === "string" && (candidate.bundle_id === saved || candidate.bundle_id.startsWith(`${saved}.`));
    const devices = `${candidate.production_devices} production, ${candidate.sandbox_devices} sandbox`;
    const note = pc.dim(`  ${devices} · last seen ${candidate.last_seen_at.slice(0, 10)}`);
    return [candidate.bundle_id, `${matches ? ok("live") : pc.yellow("test mode")}${note}`];
  });
}

export function renderApp(view: AppView): string {
  const { app } = view;
  const id = String(app.id);
  const platform = String(app.platform ?? "").toLowerCase();
  const ios = platform === "ios";
  const fix = `superwall setup apple --app ${id}`;
  const appleIdentity: [string, string][] = [
    ["App Store ID", value(app.app_id)],
    ["Apple team ID", value(app.team_id)],
    ["URL scheme", value(app.apple_url_scheme)],
  ];
  const out = [
    `${pc.bold(value(app.name))}  ${pc.dim(`${platformLabel(platform)} · ${id}`)}`,
    pc.dim(
      [view.organization.name ?? (view.organization.id && `Organization ${view.organization.id}`), `${view.project.name ?? "Project"} (${view.project.id})`]
        .filter(Boolean)
        .join("  ›  "),
    ),
  ];
  if (app.globally_disabled) out.push(pc.red("Disabled: the SDK shows no paywalls for this app."));
  if (app.archived_at) out.push(pc.yellow(`Archived ${app.archived_at}`));

  out.push(
    ...section("Identity", [
      [platform === "android" ? "Package name" : "Bundle ID", value(app.bundle_id)],
      ...(ios ? appleIdentity : []),
      ["Public API key", value(app.public_api_key)],
    ]),
  );
  if (ios) {
    out.push(
      ...section("Apple", [
        ["App Store Connect key", keyLine(view.integrations?.app_store_connect_configuration, fix)],
        ["In-App Purchase key", keyLine(view.integrations?.in_app_purchase_configuration, fix)],
        ["Notification URL", notificationLine(view, fix)],
        ["Superwall's URL", view.notification_url ? pc.dim(view.notification_url) : ""],
        ["Search Ads", app.apple_search_ads_configured ? ok("connected") : pc.dim("not connected")],
      ]),
    );
  }
  if (view.sdk) out.push(...section(`SDK, last ${view.sdk.window_days} days`, sdkRows(view.sdk, app.bundle_id)));
  out.push(...section("Revenue", [["Provider", revenueLine(view.integrations)]]));
  out.push(
    ...section("Support & web", [
      ["Support URL", app.support_url ? String(app.support_url) : ""],
      ["Support email", app.support_email ? String(app.support_email) : ""],
      ["Redirect URL", app.notification_redirect_url ? String(app.notification_redirect_url) : ""],
      ["Stripe", app.is_stripe_application ? "this is a web checkout app" : ""],
    ]),
  );
  out.push(
    "",
    pc.dim(`Change it   superwall apps update ${id} --help`),
    pc.dim(`Raw data    superwall apps get ${id} --json`),
  );
  return out.join("\n");
}

export async function showApp(ctx: CommandContext<"required">, ref: string | undefined): Promise<void> {
  const view = await findAppView(ctx, ref);
  if (ctx.json) return ctx.output.data(view);
  ctx.output.text(renderApp(view));
}
