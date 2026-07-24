/**
 * Experiment variables ("knobs") a paywall exposes for A/B testing. The
 * schema is declared in code and serialized into the build manifest; once
 * pushed, the dashboard renders controls from it so variants are created as
 * `{ snapshot, overrides }` — no code change, no rebuild.
 *
 * Intentionally a tiny constrained builder, not zod: every spec must be
 * JSON-serializable so the dashboard can render it.
 */

export type VariableSpec =
  | { type: "string"; default: string; label?: string }
  | { type: "boolean"; default: boolean; label?: string }
  | { type: "number"; default: number; min?: number; max?: number; label?: string }
  | { type: "enum"; values: readonly string[]; default: string; label?: string };

export type VariablesSchema = Record<string, VariableSpec>;

type StringOptions = { default?: string; label?: string };
type BooleanOptions = { default?: boolean; label?: string };
type NumberOptions = { default?: number; min?: number; max?: number; label?: string };
type EnumOptions<TValues extends readonly string[]> = {
  default?: TValues[number];
  label?: string;
};

/** Experiment-variable builders: `v.string`, `v.boolean`, `v.number`, `v.enum`. */
export const v = {
  string: (options: StringOptions = {}) =>
    ({ type: "string", default: options.default ?? "", label: options.label }) as const,
  boolean: (options: BooleanOptions = {}) =>
    ({ type: "boolean", default: options.default ?? false, label: options.label }) as const,
  number: (options: NumberOptions = {}) =>
    ({
      type: "number",
      default: options.default ?? 0,
      min: options.min,
      max: options.max,
      label: options.label,
    }) as const,
  enum: <const TValues extends readonly string[]>(
    values: TValues,
    options: EnumOptions<TValues> = {},
  ) =>
    ({
      type: "enum",
      values,
      default: (options.default ?? values[0]) as TValues[number],
      label: options.label,
    }) as const,
};

export type InferVariables<TSchema extends VariablesSchema> = {
  [K in keyof TSchema]: TSchema[K] extends { type: "string" }
    ? string
    : TSchema[K] extends { type: "boolean" }
      ? boolean
      : TSchema[K] extends { type: "number" }
        ? number
        : TSchema[K] extends { type: "enum"; values: infer TValues extends readonly string[] }
          ? TValues[number]
          : never;
};

/** Does an untrusted override value satisfy the spec it targets? */
const satisfiesSpec = (spec: VariableSpec, value: unknown): boolean => {
  switch (spec.type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (spec.min === undefined || value >= spec.min) &&
        (spec.max === undefined || value <= spec.max)
      );
    case "enum":
      return typeof value === "string" && spec.values.includes(value);
  }
};

const ambientOverrides = (schema: VariablesSchema): Record<string, unknown> => {
  if (typeof window === "undefined") return {};

  let parsed: unknown;
  try {
    const raw = new URLSearchParams(window.location.search).get("sw_vars");
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const spec = schema[key];
    if (spec && satisfiesSpec(spec, value)) overrides[key] = value;
  }
  return overrides;
};

export const resolveVariables = <TSchema extends VariablesSchema>(
  schema: TSchema | undefined,
  overrides: Partial<InferVariables<TSchema>> = {},
): InferVariables<TSchema> => {
  const ambient = ambientOverrides(schema ?? {});
  const resolved: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema ?? {})) {
    resolved[key] =
      key in ambient
        ? ambient[key]
        : key in overrides
          ? overrides[key as keyof typeof overrides]
          : spec.default;
  }
  return resolved as InferVariables<TSchema>;
};
