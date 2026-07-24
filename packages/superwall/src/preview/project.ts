import * as path from "node:path";
import { importDefault } from "../config/load";
import type { PaywallDefinition } from "../config";
import { discoverProject } from "../discover";
import { readLock } from "../lock";

export type ConfigLoader = (file: string) => Promise<PaywallDefinition | undefined>;

export type StudioSurfacePayload = {
  kind: "paywall" | "funnel";
  id: string;
  pageRoutes: string[];
  locales: string[];
  variables?: PaywallDefinition["variables"];
  paywallId?: string;
};

export type StudioProjectPayload = {
  title: string;
  surfaces: StudioSurfacePayload[];
  diagnostics: string[];
};

export const buildStudioProject = async (
  projectRoot: string,
  loadConfig: ConfigLoader = importDefault,
): Promise<StudioProjectPayload> => {
  const project = discoverProject(projectRoot);
  const lock = readLock(project.superwallDir);

  const surfaces = await Promise.all(
    project.surfaces.map(async (surface): Promise<StudioSurfacePayload> => {
      const definition = surface.configFile ? await loadConfig(surface.configFile) : undefined;

      const locales = new Set<string>();
      for (const entry of [...project.sharedMessages, ...surface.messages]) {
        locales.add(entry.locale);
      }
      for (const locale of Object.keys(definition?.localization?.messages ?? {})) {
        locales.add(locale);
      }

      const binding =
        surface.kind === "paywall" ? lock.paywalls[surface.id] : lock.funnels[surface.id];

      return {
        kind: surface.kind,
        id: surface.id,
        pageRoutes: surface.pages.map((page) => page.route),
        locales: [...locales].toSorted(),
        variables: definition?.variables,
        paywallId: binding?.paywallId,
      };
    }),
  );

  return {
    title: path.basename(project.root),
    surfaces,
    diagnostics: project.diagnostics,
  };
};
