import type { StudioSurface, StudioSurfaceKind } from "./surfaces";
import type { SampleDefaults } from "./variables";

export type StudioProjectPayload = {
  title: string;
  scheme?: string;
  networkOrigin?: string;
  surfaces: StudioSurface[];
  samples: SampleDefaults;
  diagnostics: string[];
  capabilities: { actions: boolean };
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const parseSurface = (value: unknown): StudioSurface | undefined => {
  if (!isRecord(value)) return undefined;
  const kind: StudioSurfaceKind | undefined =
    value.kind === "paywall" || value.kind === "funnel" ? value.kind : undefined;
  if (!kind || typeof value.id !== "string") return undefined;
  return {
    kind,
    id: value.id,
    ...(typeof value.project === "string" ? { project: value.project } : {}),
    routes: isStringArray(value.routes) ? value.routes : [],
    products: isStringRecord(value.products) ? value.products : {},
    locales: isStringArray(value.locales) ? value.locales : [],
    ...(isStringArray(value.platforms) ? { platforms: value.platforms } : {}),
    paywallId: typeof value.paywallId === "string" ? value.paywallId : undefined,
  };
};

export const parseProjectPayload = (data: unknown): StudioProjectPayload => {
  if (!isRecord(data)) {
    throw new Error("project payload is not an object");
  }
  const surfaces = Array.isArray(data.surfaces)
    ? data.surfaces.map(parseSurface).filter((surface) => surface !== undefined)
    : [];
  const capabilities = isRecord(data.capabilities) ? data.capabilities : {};
  const samples = isRecord(data.samples) ? data.samples : {};
  const group = (key: string): Record<string, unknown> =>
    isRecord(samples[key]) ? (samples[key] as Record<string, unknown>) : {};
  return {
    title: typeof data.title === "string" ? data.title : "superwall",
    scheme: typeof data.scheme === "string" ? data.scheme : undefined,
    networkOrigin: typeof data.networkOrigin === "string" ? data.networkOrigin : undefined,
    surfaces,
    diagnostics: isStringArray(data.diagnostics) ? data.diagnostics : [],
    samples: {
      device: group("device"),
      user: group("user"),
      params: group("params"),
    },
    capabilities: { actions: capabilities.actions === true },
  };
};
