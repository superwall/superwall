import type { Application } from "@/core/api/resources";
import { platformLabel } from "@/core/api/resources";
import { ui } from "@/ui";

export async function pickApplicationOption(apps: Application[]): Promise<Application | null> {
  const picked = await ui.select({
    message: "Which app do these paywalls belong to?",
    options: apps.map((app) => ({
      value: String(app.id),
      label: app.name ?? app.bundle_id ?? String(app.id),
      hint: platformLabel(app.platform),
    })),
  });
  if (!picked) return null;
  return apps.find((app) => String(app.id) === picked) ?? null;
}
