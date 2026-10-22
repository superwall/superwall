import { field, listField, textField } from "@/core/json";
import type { AppleSession } from "./session";

export interface AppleApp {
  id: string;
  name?: string;
  bundleId?: string;
}

function readApps(body: unknown): AppleApp[] {
  return listField(body, "data").flatMap((app) => {
    const id = textField(app, "id");
    if (!id) return [];
    const attributes = field(app, "attributes");
    return [{ id, name: textField(attributes, "name"), bundleId: textField(attributes, "bundleId") }];
  });
}

export async function listApps(session: AppleSession): Promise<AppleApp[]> {
  return readApps(await session.iris("GET", "/apps", { query: { limit: "200" } }));
}

export async function findApp(
  session: AppleSession,
  bundleId: string,
): Promise<AppleApp | undefined> {
  const body = await session.iris("GET", "/apps", {
    query: { "filter[bundleId]": bundleId, limit: "10" },
  });
  return readApps(body).find((app) => app.bundleId === bundleId);
}
