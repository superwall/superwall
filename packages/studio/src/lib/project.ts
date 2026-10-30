import { parsePresentation } from "./presentation";
import type {
  StudioAppIdentity,
  StudioOrigin,
  StudioScreenFramework,
  StudioSurface,
  StudioSurfaceKind,
} from "./surfaces";
import type { SampleDefaults } from "./variables";

export type StudioProjectPayload = {
  title: string;
  app?: StudioAppIdentity;
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
  const presentation = parsePresentation(
    isRecord(value.settings) ? value.settings.presentation_style : undefined,
  );
  const origin = parseOrigin(value.origin);
  return {
    kind,
    id: value.id,
    ...(typeof value.project === "string" ? { project: value.project } : {}),
    ...(typeof value.label === "string" && value.label !== "" ? { label: value.label } : {}),
    routes: isStringArray(value.routes) ? value.routes : [],
    products: isStringRecord(value.products) ? value.products : {},
    locales: isStringArray(value.locales) ? value.locales : [],
    ...(isStringArray(value.platforms) ? { platforms: value.platforms } : {}),
    ...(presentation === undefined ? {} : { presentation }),
    paywallId: typeof value.paywallId === "string" ? value.paywallId : undefined,
    ...(origin === undefined ? {} : { origin }),
  };
};

const parseApp = (value: unknown): StudioAppIdentity | undefined => {
  if (!isRecord(value) || typeof value.name !== "string" || value.name === "") return undefined;
  return typeof value.iconUrl === "string" && value.iconUrl !== ""
    ? { name: value.name, iconUrl: value.iconUrl }
    : { name: value.name };
};

const isFileName = (value: unknown): value is string =>
  typeof value === "string" && value !== "" && !/[\\/]/.test(value) && !value.startsWith(".");

const SCREEN_FRAMEWORKS: ReadonlySet<string> = new Set([
  "swiftui",
  "uikit",
  "compose",
  "android-views",
  "react-native",
  "flutter",
]);

const parseOrigin = (value: unknown): StudioOrigin | undefined => {
  if (!isRecord(value)) return undefined;
  if (typeof value.paywallId === "string" && typeof value.url === "string") {
    return { paywallId: value.paywallId, url: value.url };
  }
  if (
    typeof value.path === "string" &&
    typeof value.framework === "string" &&
    SCREEN_FRAMEWORKS.has(value.framework)
  ) {
    const framework = value.framework as StudioScreenFramework;
    return isFileName(value.screenshot)
      ? { path: value.path, framework, screenshot: value.screenshot }
      : { path: value.path, framework };
  }
  return undefined;
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
  const app = parseApp(data.app);
  return {
    title: typeof data.title === "string" ? data.title : "superwall",
    ...(app === undefined ? {} : { app }),
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
