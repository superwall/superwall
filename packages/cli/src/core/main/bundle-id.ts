import type { CommandContext } from "@/program/command";
import type { SuperwallApi } from "@/core/api/client";
import {
  listBundleIdSuggestions,
  RefusedByApi,
  type BundleIdCandidate,
  type BundleIdSuggestions,
} from "@/core/api/integrations";
import { apiCall } from "@/ui/spinner";

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
      listBundleIdSuggestions(api, applicationId),
    );
  } catch (error) {
    if (error instanceof RefusedByApi) return null;
    throw error;
  }
}

function exposureLine(exposure: { devices: number; bundleIds: string[] }, windowDays: number): string {
  return `${exposure.devices} production device${exposure.devices === 1 ? "" : "s"} in the last ${windowDays} days used ${exposure.bundleIds.join(", ")}, and would run in test mode.`;
}

export async function testModeWarning(
  ctx: CommandContext,
  api: SuperwallApi,
  applicationId: string,
  bundleId: string,
): Promise<string | undefined> {
  const read = await suggestions(ctx, api, applicationId);
  if (!read?.available) return undefined;
  const exposure = testModeExposure(bundleId, read.candidates);
  if (exposure.devices === 0) return undefined;
  return `Saving the bundle ID ${bundleId}: ${exposureLine(exposure, read.window_days)}`;
}
