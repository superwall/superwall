import type { CommandContext } from "@/program/command";
import {
  findIntegrations,
  replaceRevenueProvider,
  type IntegrationsOverview,
  type RevenueProvider,
} from "@/core/api/integrations";
import { apiCall } from "@/ui/spinner";

const REVENUE_PROVIDERS: RevenueProvider[] = ["open_revenue", "revenue_cat"];

const LABEL: Record<RevenueProvider, string> = {
  open_revenue: "the app's store, sent straight to Superwall",
  revenue_cat: "RevenueCat",
};

interface RevenueProviderChange {
  revenue_provider: RevenueProvider;
  previous: RevenueProvider | null;
  changed: boolean;
}

function sent(overview: IntegrationsOverview, provider: RevenueProvider): string | undefined {
  const events = overview.revenue_provider_events;
  if (!events) return undefined;
  const count = events[provider].events;
  return `${provider} sent ${count} event${count === 1 ? "" : "s"} in the last ${events.window_days} days`;
}

export function parseRevenueProvider(value: unknown): RevenueProvider {
  const provider = REVENUE_PROVIDERS.find((candidate) => candidate === value);
  if (!provider) throw new Error(`--revenue-provider takes ${REVENUE_PROVIDERS.join(" or ")}.`);
  return provider;
}

export async function updateRevenueProvider(
  ctx: CommandContext<"required">,
  app: { id: string; name: string },
  wanted: RevenueProvider,
  yes: boolean,
): Promise<RevenueProviderChange> {
  const overview = await apiCall(ctx, "Loading revenue tracking", () => findIntegrations(ctx.api, app.id));
  const previous = overview.revenue_provider;
  if (previous === wanted) {
    if (!ctx.json) ctx.ui.success(`\`${app.name}\` already counts revenue from ${wanted}.`);
    return { revenue_provider: wanted, previous, changed: false };
  }

  const consequence = [
    `Every revenue figure in the dashboard for ${app.name} will count only events from ${wanted} (${LABEL[wanted]}).`,
    previous
      ? `Events from ${previous} keep arriving and being stored, but stop being counted.`
      : "Events from the other source keep arriving and being stored, but stop being counted.",
    ...REVENUE_PROVIDERS.map((provider) => sent(overview, provider))
      .filter((line): line is string => line !== undefined)
      .map((line) => `${line}.`),
  ].join("\n");

  if (ctx.dryRun) {
    if (!ctx.json) ctx.ui.info(`[dry-run] would change the revenue provider to ${wanted}.\n${consequence}`);
    return { revenue_provider: wanted, previous, changed: false };
  }
  if (!yes) {
    if (!ctx.interactive) {
      throw new Error(
        `${consequence}\nNothing was changed. This is a person's decision: once they agree, run it again with --yes.`,
      );
    }
    ctx.ui.warn(consequence);
    const agreed = await ctx.ui.confirm({ message: `Count revenue from ${wanted}?` });
    if (!agreed) throw new Error("Cancelled. Nothing was changed.");
  }

  const saved = await apiCall(ctx, "Saving the revenue provider", () => {
    return replaceRevenueProvider(ctx.api, app.id, wanted);
  });
  if (!ctx.json) ctx.ui.success(`\`${app.name}\` now counts revenue from ${saved}.`);
  return { revenue_provider: saved, previous, changed: true };
}
