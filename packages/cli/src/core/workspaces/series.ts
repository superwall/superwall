import { METRIC_LIMITS, READOUT_LIMITS } from "./wire";
import { WorkspaceError, type MetricDefinition } from "./project";

export interface MetricPoint {
  t: string;
  value: number;
  breakdown?: string | null;
}

export interface MetricSeries {
  points: readonly MetricPoint[];
}

export interface ReadoutResult {
  variants: readonly { variantId: number; value: number | null; interval?: readonly [number, number] }[];
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));

const isKey = (value: unknown) => value === null || value === undefined || (typeof value === "string" && value.length >= 1 && value.length <= 128);

export function seriesProblem(value: unknown): string | undefined {
  const points = (value as MetricSeries | null | undefined)?.points;
  if (!Array.isArray(points)) return "It must return { points: [...] }.";
  if (points.length > METRIC_LIMITS.maxPoints) {
    return `It returned ${points.length} points; the limit is ${METRIC_LIMITS.maxPoints}.`;
  }
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > METRIC_LIMITS.maxBytes) return `It returned ${bytes} bytes; the limit is ${METRIC_LIMITS.maxBytes}.`;
  for (const point of points as readonly Partial<MetricPoint>[]) {
    if (!isTimestamp(point?.t)) {
      return `A point's t must be an ISO 8601 date-time with an offset, like 2026-10-01T00:00:00Z. Got ${JSON.stringify(point?.t)}.`;
    }
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) {
      return `The point at ${point.t} has a value that isn't a finite number: ${JSON.stringify(point.value)}.`;
    }
    if (!isKey(point.breakdown)) {
      return `The point at ${point.t} has a breakdown that isn't 1 to 128 characters.`;
    }
  }
  const series = new Set((points as readonly MetricPoint[]).map((point) => point.breakdown ?? null));
  if (series.size > METRIC_LIMITS.maxSeries) {
    return `It returned ${series.size} breakdown values; the limit is ${METRIC_LIMITS.maxSeries}.`;
  }
  return undefined;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function variantProblem(variant: unknown, seen: Set<number>, variantIds: readonly number[]): string | undefined {
  const { variantId, value, interval } = (variant ?? {}) as Record<string, unknown>;
  if (typeof variantId !== "number" || !Number.isSafeInteger(variantId) || variantId <= 0) {
    return `A variant has a variantId that isn't a positive whole number: ${JSON.stringify(variantId)}.`;
  }
  if (seen.has(variantId)) return `Variant ${variantId} appears twice.`;
  seen.add(variantId);
  if (variantIds.length > 0 && !variantIds.includes(variantId)) {
    return `Variant ${variantId} isn't one of this audience's variants.`;
  }
  if (value !== null && !isFiniteNumber(value)) {
    return `Variant ${variantId} has a value that isn't a finite number or null.`;
  }
  if (interval === undefined) return undefined;
  if (!Array.isArray(interval) || interval.length !== 2 || !interval.every(isFiniteNumber)) {
    return `Variant ${variantId} has an interval that isn't two finite numbers.`;
  }
  const [lower, upper] = interval as [number, number];
  if (value === null || lower > value || value > upper) {
    return `Variant ${variantId} has an interval that doesn't hold its value.`;
  }
  return undefined;
}

export function readoutProblem(value: unknown, variantIds: readonly number[]): string | undefined {
  const variants = (value as ReadoutResult | null | undefined)?.variants;
  if (!Array.isArray(variants)) return "It must return { variants: [...] }.";
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > READOUT_LIMITS.maxBytes) return `It returned ${bytes} bytes; the limit is ${READOUT_LIMITS.maxBytes}.`;
  const seen = new Set<number>();
  for (const variant of variants as readonly unknown[]) {
    const problem = variantProblem(variant, seen, variantIds);
    if (problem) return problem;
  }
  return undefined;
}

export interface MetricQuery {
  breakdown?: string | null;
  filters?: Readonly<Record<string, readonly string[]>>;
}

export function checkMetricQuery(metric: MetricDefinition | undefined, query: MetricQuery): void {
  const breakdown = query.breakdown ?? null;
  if (breakdown !== null && !(metric?.breakdowns ?? []).some((candidate) => candidate.key === breakdown)) {
    throw new WorkspaceError(`\`${breakdown}\` is not a breakdown this metric declares.`);
  }
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    const filter = (metric?.filters ?? []).find((candidate) => candidate.key === key);
    if (!filter || values.some((value) => !filter.values.some((option) => option.value === value))) {
      throw new WorkspaceError(`\`${key}\` has a filter or value this metric doesn't declare.`);
    }
  }
}

export function parseFilters(pairs: readonly string[]): Record<string, string[]> {
  const filters = Object.create(null) as Record<string, string[]>;
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0 || separator === pair.length - 1) {
      throw new WorkspaceError(`--filter takes key=value, not \`${pair}\`.`);
    }
    const key = pair.slice(0, separator);
    filters[key] = [...(filters[key] ?? []), pair.slice(separator + 1)];
  }
  return filters;
}

export interface SeriesSummary {
  name: string;
  breakdown: string | null;
  points: number;
  sum: number;
  lastAt: string;
  last: number;
}

export function summarizeSeries(series: MetricSeries): SeriesSummary[] {
  const groups = new Map<string | null, MetricPoint[]>();
  for (const point of series.points) {
    const breakdown = point.breakdown ?? null;
    groups.set(breakdown, [...(groups.get(breakdown) ?? []), point]);
  }
  return [...groups.entries()].map(([breakdown, points]) => {
    const latest = points.reduce((best, point) => (Date.parse(point.t) > Date.parse(best.t) ? point : best));
    return {
      name: breakdown ?? "All",
      breakdown,
      points: points.length,
      sum: points.reduce((total, point) => total + point.value, 0),
      lastAt: latest.t,
      last: latest.value,
    };
  });
}
