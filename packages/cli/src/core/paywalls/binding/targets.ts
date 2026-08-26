import type { FrameworkSurface } from "../project/framework";
import { describePlatforms, platformFor } from "./apps";

export interface SurfaceTarget {
  surface: FrameworkSurface;
  platform: string;
  applicationId: string;
}

export type DeclaredPlatforms = Record<string, string[] | undefined>;

export class TargetError extends Error {}

export const surfaceKey = (surface: { kind: string; id: string }): string =>
  `${surface.kind}/${surface.id}`;

export const targetLabel = (
  target: { surface: FrameworkSurface; platform: string },
  multi: boolean,
): string => (multi ? `${target.surface.id} · ${target.platform}` : target.surface.id);

export function wantedPlatforms(
  surfaces: readonly FrameworkSurface[],
  declared: DeclaredPlatforms,
): string[] {
  const wanted = new Set<string>();
  for (const surface of surfaces) {
    for (const platform of declared[surfaceKey(surface)] ?? []) wanted.add(platform);
  }
  return [...wanted];
}

export function parsePlatformFlags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function planTargets(input: {
  surfaces: readonly FrameworkSurface[];
  declared: DeclaredPlatforms;
  apps: Record<string, string>;
  only?: readonly string[];
}): SurfaceTarget[] {
  const { surfaces, declared, apps } = input;
  const known = Object.keys(apps);

  const only = (input.only ?? []).map((entry) => {
    const platform = platformFor(apps, entry);
    if (platform === undefined) {
      throw new TargetError(
        `This project has no app for "${entry}" — its platforms are ${describePlatforms(apps) || "none"} ` +
          "(the keys under `apps` in superwall.lock). Declare it in a config.ts with `platforms: [...]` to bind one.",
      );
    }
    return platform;
  });

  const targets: SurfaceTarget[] = [];
  for (const surface of surfaces) {
    const wanted = declared[surfaceKey(surface)];
    let platforms: string[];
    if (wanted !== undefined) {
      if (wanted.length === 0) {
        throw new TargetError(
          `${surface.kind} \`${surface.id}\` declares \`platforms: []\` — list at least one, or remove the field.`,
        );
      }
      for (const platform of wanted) {
        if (!(platform in apps)) {
          throw new TargetError(
            `${surface.kind} \`${surface.id}\` targets \`${platform}\`, which superwall.lock does not bind to an app.`,
          );
        }
      }
      platforms = [...new Set(wanted)];
    } else if (known.length === 1 && known[0] !== undefined) {
      platforms = [known[0]];
    } else if (known.length === 0) {
      throw new TargetError("This project is not bound to an app yet — run `superwall push` to pick one.");
    } else {
      throw new TargetError(
        `${surface.kind} \`${surface.id}\` doesn't say which platforms it's for, and this project pushes to several ` +
          `(${describePlatforms(apps)}). Add \`platforms: [...]\` to ${surface.kind}s/${surface.id}/config.ts.`,
      );
    }
    for (const platform of platforms) {
      if (only.length > 0 && !only.includes(platform)) continue;
      const applicationId = apps[platform];
      if (applicationId === undefined) continue;
      targets.push({ surface, platform, applicationId });
    }
  }

  if (targets.length === 0 && only.length > 0) {
    throw new TargetError(
      `No paywall or funnel targets ${only.map((platform) => `\`${platform}\``).join(", ")}.`,
    );
  }
  return targets;
}
