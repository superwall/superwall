import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { SuperwallConfig } from "@superwall/runtime";
import type { DiscoveredSurface, Project } from "../discover";
import { mergeSurfaceConfig, type SuperwallAppConfig } from "./app";
import type { PaywallDefinition } from "./paywall";

export const importDefault = async <T>(file: string | undefined): Promise<T | undefined> => {
  if (!file) return undefined;
  const url = pathToFileURL(file).href;
  try {
    const { mtimeMs } = fs.statSync(file);
    const mod = (await import(`${url}?mtime=${mtimeMs}`)) as { default?: T };
    return mod.default;
  } catch {
    try {
      const mod = (await import(url)) as { default?: T };
      return mod.default;
    } catch {
      // A broken config shouldn't take the whole project down: the surface
      // still lists, and mounting it reports the real error.
      return undefined;
    }
  }
};

export type LoadedSurfaceConfig = {
  /** The surface's own `config.ts` default export. */
  definition: PaywallDefinition | undefined;
  /** The project's `superwall/config.ts` default export. */
  appConfig: SuperwallAppConfig | undefined;
  /** Definition merged over app defaults — what the runtime session sees. */
  config: SuperwallConfig;
};

export const loadSurfaceConfig = async (
  project: Project,
  surface: DiscoveredSurface,
  load: <T>(file: string | undefined) => Promise<T | undefined> = importDefault,
): Promise<LoadedSurfaceConfig> => {
  const [definition, appConfig] = await Promise.all([
    load<PaywallDefinition>(surface.configFile),
    load<SuperwallAppConfig>(project.appConfigFile),
  ]);
  return { definition, appConfig, config: mergeSurfaceConfig(appConfig?.defaults, definition) };
};
