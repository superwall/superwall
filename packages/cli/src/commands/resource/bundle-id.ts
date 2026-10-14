import type { CommandContext } from "@/command";
import type { SuperwallApi } from "@/core/api/client";
import { ApiError } from "@/core/api/client";
import {
  getBundleIdSuggestions,
  RefusedByApi,
  saveBundleId,
  type BundleIdCandidate,
  type BundleIdSuggestions,
} from "@/core/api/integrations";
import { listProjects } from "@/core/api/resources";
import { apiCall, emitJson } from "@/commands/api-output";
import { pickScope } from "./scope";

type Platform = "ios" | "android";

const noun = (platform: Platform) => (platform === "android" ? "package name" : "bundle ID");

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

export function testModeExposure(
  chosen: string,
  candidates: ReadonlyArray<BundleIdCandidate>,
): { devices: number; bundleIds: string[] } {
  const exposed = candidates.filter(
    (candidate) =>
      candidate.production_devices > 0 &&
      candidate.bundle_id !== chosen &&
      !candidate.bundle_id.startsWith(`${chosen}.`),
  );
  return {
    devices: exposed.reduce((sum, candidate) => sum + candidate.production_devices, 0),
    bundleIds: exposed.map((candidate) => candidate.bundle_id),
  };
}

async function suggestions(
  ctx: CommandContext,
  api: SuperwallApi,
  applicationId: string,
): Promise<BundleIdSuggestions | null> {
  try {
    return await apiCall(ctx, "Reading what the SDK reported", () =>
      getBundleIdSuggestions(api, applicationId),
    );
  } catch (error) {
    if (error instanceof RefusedByApi) return null;
    throw error;
  }
}

function candidateLine(candidate: BundleIdCandidate): string {
  const seen = candidate.last_seen_at.slice(0, 10);
  const country = candidate.top_country ? `, mostly ${candidate.top_country}` : "";
  return `\`${candidate.bundle_id}\`  ${candidate.production_devices} production, ${candidate.sandbox_devices} sandbox devices, last seen ${seen}${country}`;
}

export async function runBundleId(ctx: CommandContext<"required">): Promise<void> {
  const { api } = ctx;
  const scope = await pickScope(ctx, api, true);
  const applicationId = scope.applicationId;
  if (!applicationId) throw new Error("No app found in this project. Pass --app <id>.");
  const platform = (scope.appPlatform ?? "").toLowerCase();
  if (platform !== "ios" && platform !== "android") {
    throw new Error("Only iOS and Android apps have a bundle ID.");
  }
  const projects = await listProjects(api);
  const app = projects
    .flatMap((project) => project.applications ?? [])
    .find((candidate) => String(candidate.id) === applicationId);
  const saved = text(app?.bundle_id) ?? null;
  const name = scope.appName ?? applicationId;
  const wanted = text(ctx.argv.value);
  const read = await suggestions(ctx, api, applicationId);

  if (!wanted) {
    if (ctx.json) {
      return emitJson(ctx, {
        application_id: applicationId,
        platform,
        bundle_id: saved,
        suggestions: read,
      });
    }
    ctx.ui.step(
      saved
        ? `\`${name}\` has the ${noun(platform)} \`${saved}\``
        : `\`${name}\` has no ${noun(platform)} saved`,
    );
    if (!read) return void ctx.ui.info("This Superwall API can't suggest one yet.");
    if (!read.available) return void ctx.ui.info("The SDK's reports couldn't be read just now.");
    if (read.candidates.length === 0) {
      return void ctx.ui.info(`The SDK reported no ${noun(platform)} in the last ${read.window_days} days.`);
    }
    ctx.ui.info(`What the SDK reported in the last ${read.window_days} days:`);
    for (const candidate of read.candidates) ctx.ui.info(candidateLine(candidate));
    return;
  }

  if (saved === wanted) {
    if (ctx.json) {
      return emitJson(ctx, { application_id: applicationId, bundle_id: saved, changed: false });
    }
    return void ctx.ui.success(`\`${name}\` already has the ${noun(platform)} \`${saved}\`.`);
  }

  const replacing = saved !== null;
  if (replacing && ctx.argv.replace !== true) {
    throw new Error(
      `\`${name}\` already has the ${noun(platform)} ${saved}. Nothing was changed. Pass --replace to replace it with ${wanted}, once a person has agreed.`,
    );
  }

  const exposure = read?.available ? testModeExposure(wanted, read.candidates) : null;
  const consequences = [
    replacing
      ? `This replaces the ${noun(platform)} ${saved} with ${wanted}. Builds whose ${noun(platform)} is neither ${wanted} nor starts with "${wanted}." will run in test mode.`
      : undefined,
    exposure && exposure.devices > 0
      ? `${exposure.devices} production device${exposure.devices === 1 ? "" : "s"} in the last ${read?.window_days ?? 30} days used ${exposure.bundleIds.join(", ")}, and would run in test mode.`
      : undefined,
  ].filter((line): line is string => line !== undefined);

  if (ctx.dryRun) {
    if (ctx.json) {
      return emitJson(ctx, {
        dryRun: true,
        application_id: applicationId,
        from: saved,
        to: wanted,
        test_mode: exposure,
      });
    }
    return void ctx.ui.info(
      [`[dry-run] would save the ${noun(platform)} ${wanted} on ${name}.`, ...consequences].join("\n"),
    );
  }

  if (consequences.length > 0 && ctx.argv.yes !== true) {
    if (!ctx.interactive) {
      throw new Error(
        `${consequences.join("\n")}\nNothing was changed. This is a person's decision: once they agree, run it again with --yes.`,
      );
    }
    ctx.ui.warn(consequences.join("\n"));
    const agreed = await ctx.ui.confirm({ message: `Save ${wanted} as the ${noun(platform)}?` });
    if (!agreed) return void ctx.ui.warn("Cancelled. Nothing was changed.");
  }

  const appStoreId = text(ctx.argv["app-store-id"]);
  let result: { bundle_id: string; app_store_id: string | null };
  try {
    result = await apiCall(ctx, `Saving the ${noun(platform)}`, () =>
      saveBundleId(api, applicationId, {
        bundleId: wanted,
        ...(appStoreId ? { appStoreId } : {}),
        replace: replacing,
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new Error(`${error.message} Nothing was changed. Pass --replace to replace it, once a person has agreed.`);
    }
    throw error;
  }
  if (ctx.json) {
    return emitJson(ctx, {
      application_id: applicationId,
      bundle_id: result.bundle_id,
      app_store_id: result.app_store_id,
      changed: true,
      previous: saved,
      test_mode: exposure,
    });
  }
  ctx.ui.success(`\`${name}\` now has the ${noun(platform)} \`${result.bundle_id}\`.`);
}
