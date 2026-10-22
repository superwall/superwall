import type { CommandContext } from "@/program/command";
import { findAppNotificationUrl } from "@/core/app-store-connect/api/client";
import type { AppRef } from "@/core/app-store-connect/api/client";
import type { SuperwallApi } from "@/core/api/client";
import {
  updateServerNotifications,
  type NotificationEnvironment,
  type ServerNotifications,
} from "@/core/api/integrations";
import { chooseKeyApp } from "@/core/app-store-connect/keys/app";
import { timing } from "@/core/timing";
import { apiCall } from "@/ui/spinner";

const RETRY_DELAYS = [1000, 2000, 3000];

async function settled(
  sleep: (ms: number) => Promise<void>,
  work: () => Promise<ServerNotifications>,
): Promise<ServerNotifications> {
  for (let attempt = 0; ; attempt++) {
    const outcome = await work();
    const delay = RETRY_DELAYS[attempt];
    if (outcome.status !== "failed" || !outcome.retryable || delay === undefined) {
      return outcome;
    }
    await sleep(delay);
  }
}

export function ensureNotificationUrl(
  ctx: CommandContext,
  sleep: (ms: number) => Promise<void>,
  api: SuperwallApi,
  app: AppRef,
  options: { setRevenueProvider: boolean },
): Promise<ServerNotifications> {
  return apiCall(ctx, "Setting the server notification URL", () => {
    return settled(sleep, () => updateServerNotifications(api, app, options));
  });
}

function holder(environment: NotificationEnvironment): string {
  switch (environment.owner) {
    case "this_app":
      return "this app's Superwall URL";
    case "none":
      return "none";
    case "superwall_app":
      return environment.application
        ? `another Superwall app, ${environment.application.name} (app ${environment.application.id})`
        : "another Superwall app";
    case "other":
      return "another server";
  }
}

export function environmentLines(outcome: ServerNotifications): string[] {
  return (["production", "sandbox"] as const).flatMap((name) => {
    const environment = outcome[name];
    if (!environment) return [];
    const label = name === "production" ? "Production" : "Sandbox";
    const hidden = environment.owner === "this_app" || environment.owner === "none" || !environment.url;
    const shown = hidden ? "" : `  ${environment.url}`;
    return [`${label}: ${holder(environment)}${shown}`];
  });
}

export function describeNotificationUrl(outcome: ServerNotifications): string {
  switch (outcome.status) {
    case "set":
      return "Apple now sends this app's server notifications to Superwall.";
    case "already_set":
      return "Apple already sends this app's server notifications to Superwall.";
    case "not_set":
      return "Apple has no server notification URL for this app in production, sandbox, or both. No other server holds either.";
    case "conflict": {
      const holders = (["production", "sandbox"] as const)
        .map((name) => outcome[name])
        .filter((environment): environment is NotificationEnvironment =>
          environment?.owner === "superwall_app" || environment?.owner === "other",
        );
      const anotherApp = holders.length > 0 && holders.every((environment) => environment.owner === "superwall_app");
      return anotherApp
        ? "Apple sends this app's server notifications to another Superwall app. Superwall won't replace it."
        : "Apple sends this app's server notifications to another server. Superwall won't replace it.";
    }
    case "skipped":
      return outcome.message ?? "Apple can't be asked about this app's server notification URL.";
    case "failed":
      return outcome.message ?? "Apple couldn't be asked about this app's server notification URL.";
  }
}

export function printServerNotifications(
  ctx: CommandContext,
  applicationId: string,
  outcome: ServerNotifications,
  ok: boolean,
  extra: Record<string, unknown> = {},
): void {
  if (ctx.json) {
    ctx.output.data({
      application_id: applicationId,
      url: outcome.url,
      apple: {
        status: outcome.status,
        message: outcome.message,
        production: outcome.production,
        sandbox: outcome.sandbox,
      },
      ...extra,
    });
  } else {
    const message = [describeNotificationUrl(outcome), ...environmentLines(outcome).map((line) => `  ${line}`)].join("\n");
    if (!ok) ctx.ui.error(message);
    else if (outcome.status === "set" || outcome.status === "already_set") ctx.ui.success(message);
    else ctx.ui.info(message);
  }
  if (!ok) ctx.fail();
}

interface AscNotificationUrlSetInput {
  flags: { setRevenueProvider: boolean; app: string | undefined; project: string | undefined; dryRun: boolean; };
}

export async function runAscNotificationUrlSet(ctx: CommandContext<"required">, { flags }: AscNotificationUrlSetInput): Promise<void> {
  const { api } = ctx;
  const { app } = await chooseKeyApp(ctx, { app: flags.app, project: flags.project });
  const setRevenueProvider = flags.setRevenueProvider;
  if (ctx.dryRun) {
    const url = await apiCall(ctx, "Loading the URL", () => findAppNotificationUrl(api, app));
    if (ctx.json) {
      return ctx.output.data({
        dryRun: true,
        action: "set",
        application_id: app.applicationId,
        url,
        set_revenue_provider: setRevenueProvider,
      });
    }
    ctx.ui.info(`[dry-run] would set ${url} where Apple has no server notification URL.`);
    return;
  }
  const outcome = await ensureNotificationUrl(ctx, timing.sleep, api, app, { setRevenueProvider });
  const ok = outcome.status === "set" || outcome.status === "already_set";
  printServerNotifications(ctx, app.applicationId, outcome, ok, { set_revenue_provider: setRevenueProvider });
}
