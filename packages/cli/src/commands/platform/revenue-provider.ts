import { defineCommand } from "@/command";
import {
  getIntegrations,
  setRevenueProvider,
  type IntegrationsOverview,
  type RevenueProvider,
} from "@/core/api/integrations";
import { apiCall, emitJson } from "@/commands/api-output";
import { pickScope } from "@/commands/resource/scope";

const PROVIDERS: RevenueProvider[] = ["open_revenue", "revenue_cat"];

const LABEL: Record<RevenueProvider, string> = {
  open_revenue: "the app's store, sent straight to Superwall",
  revenue_cat: "RevenueCat",
};

function sent(overview: IntegrationsOverview, provider: RevenueProvider): string | undefined {
  const events = overview.revenue_provider_events;
  if (!events) return undefined;
  const count = events[provider].events;
  return `${provider} sent ${count} event${count === 1 ? "" : "s"} in the last ${events.window_days} days`;
}

export const runRevenueProvider = defineCommand({
  name: "revenue-provider",
  auth: "required",
  output: "both",
  async run(ctx) {
    const { api } = ctx;
    const action = (ctx.argv.action as string | undefined) ?? "get";
    if (action !== "get" && action !== "set") {
      throw new Error(`Unknown "revenue-provider ${action}". Use get | set.`);
    }
    const wanted = PROVIDERS.find((provider) => provider === ctx.argv.value);
    if (action === "set" && !wanted) {
      throw new Error("Usage: superwall revenue-provider set <open_revenue | revenue_cat> --app <id>");
    }
    const scope = await pickScope(ctx, api, true);
    const applicationId = scope.applicationId;
    if (!applicationId) throw new Error("No app found in this project. Pass --app <id>.");
    const name = scope.appName ?? applicationId;

    const overview = await apiCall(ctx, "Loading revenue tracking", () =>
      getIntegrations(api, applicationId),
    );
    const current = overview.revenue_provider;
    const events = overview.revenue_provider_events ?? null;

    if (action === "get" || !wanted) {
      if (ctx.json) {
        return emitJson(ctx, { application_id: applicationId, revenue_provider: current, events });
      }
      ctx.ui.step(
        current
          ? `\`${name}\` counts revenue from ${current} (${LABEL[current]})`
          : `\`${name}\` has no revenue provider chosen, so revenue from every source is counted`,
      );
      for (const provider of PROVIDERS) {
        const line = sent(overview, provider);
        if (line) ctx.ui.info(line);
      }
      return;
    }

    if (current === wanted) {
      if (ctx.json) {
        return emitJson(ctx, { application_id: applicationId, revenue_provider: current, changed: false });
      }
      return void ctx.ui.success(`\`${name}\` already counts revenue from ${wanted}.`);
    }

    const consequence = [
      `Every revenue figure in the dashboard for ${name} will count only events from ${wanted} (${LABEL[wanted]}).`,
      current
        ? `Events from ${current} keep arriving and being stored, but stop being counted.`
        : "Events from the other source keep arriving and being stored, but stop being counted.",
      ...PROVIDERS.map((provider) => sent(overview, provider))
        .filter((line): line is string => line !== undefined)
        .map((line) => `${line}.`),
    ].join("\n");

    if (ctx.dryRun) {
      if (ctx.json) {
        return emitJson(ctx, {
          dryRun: true,
          application_id: applicationId,
          from: current,
          to: wanted,
          events,
        });
      }
      return void ctx.ui.info(`[dry-run] would change the revenue provider to ${wanted}.\n${consequence}`);
    }

    if (ctx.argv.yes !== true) {
      if (!ctx.interactive) {
        throw new Error(
          `${consequence}\nNothing was changed. This is a person's decision: once they agree, run it again with --yes.`,
        );
      }
      ctx.ui.warn(consequence);
      const agreed = await ctx.ui.confirm({ message: `Count revenue from ${wanted}?` });
      if (!agreed) return void ctx.ui.warn("Cancelled. Nothing was changed.");
    }

    const saved = await apiCall(ctx, "Saving the revenue provider", () =>
      setRevenueProvider(api, applicationId, wanted),
    );
    if (ctx.json) {
      return emitJson(ctx, {
        application_id: applicationId,
        revenue_provider: saved,
        changed: true,
        previous: current,
      });
    }
    ctx.ui.success(`\`${name}\` now counts revenue from ${saved}.`);
  },
});
