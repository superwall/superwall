import { resolve } from "node:path";
import { defineCommand, type CommandContext } from "@/command";
import { apiCall } from "@/commands/api-output";
import { discoverPublicApiKey } from "@/core/api/discover";
import { listApplications } from "@/core/api/resources";
import { publicApiKeyFromEnv, SDK_API_HOST } from "@/environment";
import {
  BUNDLE_NAME,
  fetchStaticConfig,
  selectPaywalls,
  writeBundle,
} from "@/core/bundle/static-bundle";

const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

async function resolveApiKey(ctx: CommandContext): Promise<string> {
  const explicit = (ctx.argv.key as string | undefined) ?? publicApiKeyFromEnv();
  if (explicit) return explicit;

  if (!ctx.api) {
    throw new Error(
      "Pass the app's public API key with --key or SUPERWALL_PUBLIC_API_KEY, or run `superwall login` and pass --app.",
    );
  }
  const api = ctx.api;

  const appId = ctx.argv.app as string | undefined;
  if (appId) {
    const apps = await apiCall(ctx, "Loading apps", () => listApplications(api));
    const app = apps.find((a) => String(a.id) === appId);
    if (!app) throw new Error(`No app with id ${appId} in this organization.`);
    if (!app.public_api_key) throw new Error(`App ${appId} has no public API key.`);
    return app.public_api_key;
  }

  const found = await apiCall(ctx, "Finding your app", () =>
    discoverPublicApiKey(api, {
      onMany: async (apps) => {
        if (!ctx.interactive) return null;
        const picked = await ctx.ui.select({
          message: "Which app is this bundle for?",
          options: apps.map((a) => ({
            value: String(a.id),
            label: a.name ?? String(a.id),
            ...(a.platform ? { hint: a.platform } : {}),
          })),
        });
        return apps.find((a) => String(a.id) === picked) ?? null;
      },
    }),
  );
  if (!found) throw new Error("Several apps match. Pass --app <id> or --key <public API key>.");
  return found.apiKey;
}

export const runBundle = defineCommand({
  name: "bundle",
  auth: "optional",
  interaction: "allowed",
  output: "both",
  async run(ctx) {
    const out = resolve(ctx.installDir, (ctx.argv.out as string | undefined) ?? BUNDLE_NAME);
    const selection = {
      placements: list(ctx.argv.placement),
      paywalls: list(ctx.argv.paywall),
      all: Boolean(ctx.argv.all),
    };
    if (!selection.all && selection.placements.length === 0 && selection.paywalls.length === 0) {
      throw new Error("Choose what to bundle: --placement <name>, --paywall <identifier>, or --all.");
    }

    if (!ctx.json) ctx.ui.intro("Superwall bundle");
    const apiKey = await resolveApiKey(ctx);
    const { raw, config } = await apiCall(ctx, "Fetching static config", () =>
      fetchStaticConfig(apiKey, { apiUrl: SDK_API_HOST() }),
    );
    const paywalls = selectPaywalls(config, selection);
    if (paywalls.length === 0) throw new Error("The selection matched no paywalls.");

    const result = await apiCall(
      ctx,
      `Downloading ${paywalls.length} paywall${paywalls.length === 1 ? "" : "s"}`,
      () => writeBundle({ out, raw, config, paywalls }),
    );

    if (ctx.json) {
      ctx.output.data({
        out: result.out,
        bytes: result.bytes,
        buildId: result.manifest.buildId,
        paywalls: result.manifest.paywalls.map((p) => ({
          identifier: p.identifier,
          url: p.urls[0],
          resources: p.resources.length,
        })),
      });
      return;
    }

    ctx.ui.list({
      items: result.manifest.paywalls.map((p) => ({
        label: p.identifier,
        meta: `${p.resources.length} asset${p.resources.length === 1 ? "" : "s"}`,
      })),
    });
    ctx.ui.success(`Wrote ${result.out} (${formatBytes(result.bytes)})`);
    if (result.bytes > 20 * 1024 * 1024) {
      ctx.ui.warn("Everything in the bundle ships inside your app binary. Consider bundling fewer paywalls or using local assets.");
    }
    ctx.ui.info("Add the bundle to your app target; the SDK uses it until it has fresher config.");
  },
});
