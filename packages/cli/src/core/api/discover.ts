import { SuperwallApi } from "./client";
import { listApplications, type Application } from "./resources";

export interface DiscoveredKey {
  apiKey: string;
  app: Application;
}

export async function discoverPublicApiKey(
  api: SuperwallApi,
  opts: {
    bundleId?: string;
    onMany?: (apps: Application[]) => Promise<Application | null>;
  } = {},
): Promise<DiscoveredKey | null> {
  const apps = (await listApplications(api)).filter((a) => a.public_api_key);
  if (apps.length === 0) return null;

  if (opts.bundleId) {
    const match = apps.find((a) => a.bundle_id === opts.bundleId);
    if (match?.public_api_key) return { apiKey: match.public_api_key, app: match };
  }

  if (apps.length === 1) {
    const only = apps[0]!;
    return { apiKey: only.public_api_key!, app: only };
  }

  if (opts.onMany) {
    const picked = await opts.onMany(apps);
    if (picked?.public_api_key) return { apiKey: picked.public_api_key, app: picked };
  }
  return null;
}
