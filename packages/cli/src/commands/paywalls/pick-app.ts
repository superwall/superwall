import type { Application } from "@/core/api/resources";
import { platformLabel } from "@/core/api/resources";
import { ui } from "@/ui";

export async function pickApplicationOption(
  apps: Application[],
  platform?: string,
): Promise<Application | null> {
  const picked = await ui.select({
    message: platform
      ? `Which ${platformLabel(platform)} app do these paywalls push to? The choice is saved under apps in superwall.lock.`
      : "Which app do these paywalls belong to?",
    options: apps.map((app) => ({
      value: String(app.id),
      label: app.name ?? app.bundle_id ?? String(app.id),
      hint: platformLabel(app.platform),
    })),
  });
  if (!picked) return null;
  return apps.find((app) => String(app.id) === picked) ?? null;
}
