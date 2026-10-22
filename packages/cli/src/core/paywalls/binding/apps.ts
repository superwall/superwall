import type { SuperwallApi } from "@/core/api/client";
import { listApplications, platformLabel, type Application } from "@/core/api/resources";
import { readLock, writeApp } from "@/core/paywalls/project/lock";

export const PLATFORMS = ["ios", "android", "web"] as const;

export type Platform = (typeof PLATFORMS)[number];

export class AppBindingError extends Error {}

export type PickApplication = (
  apps: Application[],
  platform?: string,
) => Promise<Application | null>;

export const platformOf = (app: Application): Platform | undefined => {
  const normalized = (app.platform ?? "").toLowerCase();
  return PLATFORMS.find((platform) => platform === normalized);
};

export function requirePlatform(app: Application): Platform {
  const platform = platformOf(app);
  if (platform !== undefined) return platform;
  throw new AppBindingError(
    `\`${app.name ?? app.id}\` is a ${platformLabel(app.platform)} app on Superwall, and Superwall for Agents ` +
      `pushes to ${PLATFORMS.join(", ")} apps only.`,
  );
}

export const platformFor = (apps: Record<string, string>, value: string): string | undefined => {
  if (value in apps) return value;
  return Object.entries(apps).find(([, id]) => id === value)?.[0];
};

export function describePlatforms(apps: Record<string, string>): string {
  return Object.keys(apps).join(", ");
}

export async function resolveApps(input: {
  api: SuperwallApi;
  superwallDir: string;
  wanted?: readonly string[];
  pickApplication?: PickApplication;
}): Promise<Record<string, string>> {
  const { api, superwallDir } = input;
  let cached: Promise<Application[]> | undefined;
  const known = () => (cached ??= listApplications(api));
  const current = () => readLock(superwallDir).apps;

  for (const platform of new Set(input.wanted ?? [])) {
    if (!PLATFORMS.some((known) => known === platform)) {
      throw new AppBindingError(
        `"${platform}" is not a platform — use one of ${PLATFORMS.join(", ")}.`,
      );
    }
    if (platform in current()) continue;
    const bound = new Set(Object.values(current()));
    const candidates = (await known()).filter(
      (app) => !bound.has(String(app.id)) && platformOf(app) === platform,
    );
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (only) {
      writeApp(superwallDir, platform, String(only.id));
      continue;
    }
    const picked =
      candidates.length > 1 && input.pickApplication
        ? await input.pickApplication(candidates, platform)
        : null;
    if (picked) {
      writeApp(superwallDir, platform, String(picked.id));
      continue;
    }
    const label = platformLabel(platform);
    throw new AppBindingError(
      candidates.length === 0
        ? `Your account has no ${label} app to bind — create one with \`superwall apps create --platform ${platform}\` or in the dashboard, then push again.`
        : `Several ${label} apps in your account — run \`superwall push\` interactively once to pick one, ` +
            `or add "${platform}": "<app id>" under "apps" in superwall.lock (\`superwall apps list\` shows ids).`,
    );
  }

  if (Object.keys(current()).length > 0) return current();

  const apps = await known();
  if (apps.length === 1 && apps[0] !== undefined) {
    writeApp(superwallDir, requirePlatform(apps[0]), String(apps[0].id));
    return current();
  }
  if (apps.length > 1 && input.pickApplication) {
    const picked = await input.pickApplication(apps);
    if (picked) {
      writeApp(superwallDir, requirePlatform(picked), String(picked.id));
      return current();
    }
  }
  throw new AppBindingError(
    apps.length === 0
      ? "Your account has no apps yet — create one with `superwall apps create` or in the dashboard."
      : "Several apps in your account — run `superwall push` interactively once to pick one; the choice is saved to superwall.lock.",
  );
}
