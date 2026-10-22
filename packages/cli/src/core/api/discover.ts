import type { SuperwallApi } from "./client";
import { listApplications, type Application } from "./resources";

interface DiscoveredKey {
  apiKey: string;
  app: Application;
}

export async function discoverPublicApiKey(api: SuperwallApi): Promise<DiscoveredKey | null> {
  const keys = (await listApplications(api)).flatMap((app) =>
    app.public_api_key ? [{ apiKey: app.public_api_key, app }] : [],
  );
  const [only, ...rest] = keys;
  return only && rest.length === 0 ? only : null;
}
