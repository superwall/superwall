import type { CommandContext } from "@/command";
import type { SuperwallApi } from "@/core/api/client";
import { getAppNotificationUrl, type AppRef } from "@/core/api/asc";
import {
  checkNotificationUrl,
  writeNotificationUrl,
  type NotificationOutcome,
} from "@/core/api/integrations";
import { apiCall, emitJson } from "@/commands/api-output";
import { chooseIosApp } from "./apple-app";
import { appFlags } from "./apple-keys";

const RETRY_DELAYS = [5000, 10_000, 15_000, 15_000, 15_000];

async function settled(
  sleep: (ms: number) => Promise<void>,
  work: () => Promise<NotificationOutcome>,
): Promise<NotificationOutcome> {
  for (let attempt = 0; ; attempt++) {
    const outcome = await work();
    const delay = RETRY_DELAYS[attempt];
    if (outcome.status !== "failed" || outcome.retryable !== true || delay === undefined) {
      return outcome;
    }
    await sleep(delay);
  }
}

export async function ensureNotificationUrl(
  ctx: CommandContext,
  sleep: (ms: number) => Promise<void>,
  api: SuperwallApi,
  app: AppRef,
  options: { setRevenueProvider: boolean },
): Promise<NotificationOutcome> {
  const found = await apiCall(ctx, "Reading the server notification URL", () =>
    settled(sleep, () => checkNotificationUrl(api, app)),
  );
  if (found.status !== "not_set" && !(found.status === "already_set" && options.setRevenueProvider)) {
    return found;
  }
  return apiCall(ctx, "Setting the server notification URL", () =>
    settled(sleep, () => writeNotificationUrl(api, app, options)),
  );
}

export function describeNotificationUrl(outcome: NotificationOutcome): string {
  const existing = [
    outcome.production_url ? `Production: ${outcome.production_url}` : undefined,
    outcome.sandbox_url ? `Sandbox: ${outcome.sandbox_url}` : undefined,
  ].filter((line): line is string => line !== undefined);
  switch (outcome.status) {
    case "set":
      return "Apple now sends this app's server notifications to Superwall.";
    case "already_set":
      return "Apple already sends this app's server notifications to Superwall.";
    case "not_set":
      return "Apple has no server notification URL for this app in production, sandbox, or both. No other server holds either.";
    case "conflict":
      return [
        "Apple sends this app's server notifications to another server. Superwall won't replace it.",
        ...existing.map((line) => `  ${line}`),
      ].join("\n");
    case "skipped":
      return "This app has no App Store Connect API key saved in Superwall, so Apple can't be asked.";
    case "failed":
      return outcome.message ?? "Apple couldn't be asked about this app's server notification URL.";
  }
}

export async function runNotificationUrl(
  ctx: CommandContext<"required">,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const { api } = ctx;
  const action = (ctx.argv.value as string | undefined) ?? "get";
  if (action !== "get" && action !== "check" && action !== "set") {
    throw new Error(`Unknown "asc notification-url ${action}". Use get | check | set.`);
  }
  const chosen = await chooseIosApp(ctx, api, appFlags(ctx));
  const app: AppRef = { projectId: String(chosen.project.id), applicationId: String(chosen.app.id) };

  const url = await apiCall(ctx, "Loading the URL", () => getAppNotificationUrl(api, app));
  if (action === "get") {
    if (ctx.json) return emitJson(ctx, { application_id: app.applicationId, url });
    ctx.output.text(url);
    return;
  }

  const setRevenueProvider = ctx.argv["set-revenue-provider"] === true;
  if (action === "set" && ctx.dryRun) {
    if (ctx.json) {
      return emitJson(ctx, {
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

  const outcome =
    action === "check"
      ? await apiCall(ctx, "Reading the server notification URL", () =>
          settled(sleep, () => checkNotificationUrl(api, app)),
        )
      : await ensureNotificationUrl(ctx, sleep, api, app, { setRevenueProvider });
  const ok =
    action === "check"
      ? outcome.status !== "failed" && outcome.status !== "skipped"
      : outcome.status === "set" || outcome.status === "already_set";

  if (ctx.json) {
    emitJson(ctx, {
      application_id: app.applicationId,
      url,
      apple: {
        status: outcome.status,
        message: outcome.message,
        production_url: outcome.production_url,
        sandbox_url: outcome.sandbox_url,
      },
      ...(action === "set" ? { set_revenue_provider: setRevenueProvider } : {}),
    });
  } else {
    const message = describeNotificationUrl(outcome);
    if (!ok) ctx.ui.error(message);
    else if (outcome.status === "set" || outcome.status === "already_set") ctx.ui.success(message);
    else ctx.ui.info(message);
  }
  if (!ok) process.exitCode = 1;
}
