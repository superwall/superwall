import * as path from "node:path";
import { importDefault } from "../config/load";
import type { PaywallDefinition } from "../config";
import { MOCK_DEVICE_VARIABLES, normalizeProductSlot } from "@superwall/runtime";
import { discoverProject } from "../discover";
import { readLock } from "../lock";

export type ConfigLoader = (file: string) => Promise<PaywallDefinition | undefined>;

export type StudioSurfacePayload = {
  kind: "paywall" | "funnel";
  id: string;
  project?: string;
  routes: string[];
  locales: string[];
  products: Record<string, string>;
  paywallId?: string;
  editedAt?: string;
};

export type StudioProjectPayload = {
  title: string;
  surfaces: StudioSurfacePayload[];
  diagnostics: string[];
};

export type SampleDefaults = typeof SAMPLE_DEFAULTS;

export type StudioProjectEntry = { slug: string; title: string };

export const SAMPLE_DEFAULTS = {
  device: MOCK_DEVICE_VARIABLES as Record<string, unknown>,
  user: {
    applicationInstalledAt: "2026-01-01T00:00:00Z",
    subscriptionStatus: "INACTIVE",
  } as Record<string, unknown>,
  params: {
    $event_name: "campaign_trigger",
    event_name: "campaign_trigger",
    $is_standard_event: false,
    $is_feature_gatable: false,
  } as Record<string, unknown>,
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
        routes: surface.routes.map((route) => route.name),
        locales: [...locales].toSorted(),
        products: Object.fromEntries(
          Object.entries(definition?.products ?? {}).map(([reference, input]) => [
            reference,
            normalizeProductSlot(input).productId ?? reference,
          ]),
        ),
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

export const buildStudioProjects = async (
  entries: readonly { slug: string; root: string }[],
  loadConfig: ConfigLoader = importDefault,
): Promise<StudioProjectPayload & { projects: StudioProjectEntry[]; samples: SampleDefaults }> => {
  const built = await Promise.all(
    entries.map(async (entry) => ({
      slug: entry.slug,
      payload: await buildStudioProject(entry.root, loadConfig),
    })),
  );

  const only = built.length === 1 ? built[0] : undefined;
  if (only) {
    return {
      ...only.payload,
      projects: [{ slug: only.slug, title: only.payload.title }],
      samples: SAMPLE_DEFAULTS,
    };
  }

  return {
    title: `${built.length} projects`,
    projects: built.map((one) => ({ slug: one.slug, title: one.payload.title })),
    samples: SAMPLE_DEFAULTS,
    surfaces: built.flatMap((one) =>
      one.payload.surfaces.map((surface) => ({ ...surface, project: one.slug })),
    ),
    diagnostics: built.flatMap((one) => one.payload.diagnostics),
  };
};
