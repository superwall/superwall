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
      return undefined;
    }
  }
};

export type LoadedSurfaceConfig = {
  definition: PaywallDefinition | undefined;
  appConfig: SuperwallAppConfig | undefined;
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
