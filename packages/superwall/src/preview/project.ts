import * as path from "node:path";
import { paywallSettingsOf, type PaywallSettings } from "../build/settings";
import { importDefault } from "../config/load";
import { localesOf } from "../config/messages";
import type { PaywallDefinition } from "../config";
import {
  isPlatformProductIds,
  normalizePlatform,
  productIdFor,
  type SuperwallProductSlotInput,
} from "@superwall/runtime";
import { DEFAULT_PARAMS, DEFAULT_USER, defaultDevice } from "@superwall/host/defaults";
import { discoverProject } from "../discover";
import { firstBinding, readLock } from "../lock";

export type ConfigLoader = (file: string) => Promise<PaywallDefinition | undefined>;

export type StudioSurfacePayload = {
  kind: "paywall" | "funnel";
  id: string;
  project?: string;
  routes: string[];
  locales: string[];
  products: Record<string, string>;
  productIds: Record<string, string[]>;
  settings: PaywallSettings;
  platforms?: string[];
  paywallId?: string;
  editedAt?: string;
};

const declaredPlatforms = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;

const productIdsOf = (input: SuperwallProductSlotInput): string[] => {
  if (typeof input === "string") return [input];
  if (isPlatformProductIds(input)) {
    return [...new Set(Object.values(input).filter((id) => typeof id === "string"))];
  }
  return [input.productId].filter((id) => typeof id === "string");
};

export type StudioProjectPayload = {
  title: string;
  surfaces: StudioSurfacePayload[];
  diagnostics: string[];
};

export type SampleDefaults = typeof SAMPLE_DEFAULTS;

export type StudioProjectEntry = { slug: string; title: string };

export const SAMPLE_DEFAULTS: {
  device: Record<string, unknown>;
  user: Record<string, unknown>;
  params: Record<string, unknown>;
} = {
  device: defaultDevice(),
  user: DEFAULT_USER,
  params: DEFAULT_PARAMS,
};

export const buildStudioProject = async (
  projectRoot: string,
  loadConfig: ConfigLoader = importDefault,
): Promise<StudioProjectPayload> => {
  const project = discoverProject(projectRoot);
  const lock = readLock(project.superwallDir);

  const surfaces = await Promise.all(
    project.surfaces.map(async (surface): Promise<StudioSurfacePayload> => {
      const definition = await loadConfig(surface.configFile);

      const binding =
        surface.kind === "paywall" ? lock.paywalls[surface.id] : lock.funnels[surface.id];
      const platforms = declaredPlatforms(definition?.platforms);
      const platform = normalizePlatform(platforms?.[0] ?? Object.keys(lock.apps)[0]);
      const slots = Object.entries(definition?.products ?? {});

      return {
        kind: surface.kind,
        id: surface.id,
        routes: surface.routes.map((route) => route.name),
        locales: localesOf(project, surface, definition),
        products: Object.fromEntries(
          slots.map(([reference, input]) => [
            reference,
            productIdFor(input, platform) ?? productIdFor(input) ?? reference,
          ]),
        ),
        productIds: Object.fromEntries(
          slots.map(([reference, input]) => [reference, productIdsOf(input)]),
        ),
        settings: paywallSettingsOf(definition),
        ...(platforms === undefined ? {} : { platforms }),
        paywallId: firstBinding(binding)?.paywallId,
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
