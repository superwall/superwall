import type { StudioSurface, StudioSurfaceKind, VariableSpec, VariablesSchema } from "./types";

export type StudioProjectPayload = {
  title: string;
  surfaces: StudioSurface[];
  diagnostics: string[];
  capabilities: { actions: boolean };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const parseVariableSpec = (value: unknown): VariableSpec | undefined => {
  if (!isRecord(value)) return undefined;
  const label = typeof value.label === "string" ? value.label : undefined;
  switch (value.type) {
    case "string":
      return typeof value.default === "string"
        ? { type: "string", default: value.default, label }
        : undefined;
    case "boolean":
      return typeof value.default === "boolean"
        ? { type: "boolean", default: value.default, label }
        : undefined;
    case "number":
      return typeof value.default === "number"
        ? {
            type: "number",
            default: value.default,
            min: typeof value.min === "number" ? value.min : undefined,
            max: typeof value.max === "number" ? value.max : undefined,
            label,
          }
        : undefined;
    case "enum":
      return isStringArray(value.values) && typeof value.default === "string"
        ? { type: "enum", values: value.values, default: value.default, label }
        : undefined;
    default:
      return undefined;
  }
};

const parseVariables = (value: unknown): VariablesSchema | undefined => {
  if (!isRecord(value)) return undefined;
  const schema: VariablesSchema = {};
  for (const [name, spec] of Object.entries(value)) {
    const parsed = parseVariableSpec(spec);
    if (parsed) schema[name] = parsed;
  }
  return Object.keys(schema).length > 0 ? schema : undefined;
};

const parseSurface = (value: unknown): StudioSurface | undefined => {
  if (!isRecord(value)) return undefined;
  const kind: StudioSurfaceKind | undefined =
    value.kind === "paywall" || value.kind === "funnel" ? value.kind : undefined;
  if (!kind || typeof value.id !== "string") return undefined;
  return {
    kind,
    id: value.id,
    pageRoutes: isStringArray(value.pageRoutes) ? value.pageRoutes : [],
    locales: isStringArray(value.locales) ? value.locales : [],
    variables: parseVariables(value.variables),
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
  return {
    title: typeof data.title === "string" ? data.title : "superwall",
    surfaces,
    diagnostics: isStringArray(data.diagnostics) ? data.diagnostics : [],
    capabilities: { actions: capabilities.actions === true },
  };
};
