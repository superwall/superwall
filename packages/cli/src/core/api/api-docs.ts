import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { API_HOST, SUPERWALL_HOME } from "@/environment";

const REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DEPTH = 3;
const SEARCH_HITS = 40;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export interface DocField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  fields?: DocField[];
}

export interface DocOperation {
  method: string;
  path: string;
  group: string;
  summary: string;
  description?: string;
  scope?: string;
  params: (DocField & { in: string })[];
  body?: DocField[];
  returns: string[];
}

export interface ApiDocsIndex {
  version: string;
  fetchedAt: number;
  operations: DocOperation[];
}

const specUrl = (): string => `${process.env.SUPERWALL_API_HOST ?? API_HOST()}/openapi.json`;

function cachePath(): string {
  return join(SUPERWALL_HOME() ?? join(homedir(), ".superwall"), "api-index.json");
}

type Schema = Record<string, any>;

function typeOf(schema: Schema | undefined): string {
  if (!schema) return "any";
  const options: Schema[] | undefined = schema.anyOf ?? schema.oneOf;
  if (options) {
    const parts = options.map(typeOf);
    return [...new Set(parts)].join(" | ");
  }
  if (schema.enum) return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.type === "array") return `${typeOf(schema.items)}[]`;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  return schema.type ?? (schema.properties ? "object" : "any");
}

function objectOf(schema: Schema | undefined): Schema | undefined {
  if (!schema) return undefined;
  if (schema.properties) return schema;
  if (schema.type === "array") return objectOf(schema.items);
  for (const option of schema.anyOf ?? schema.oneOf ?? []) {
    const found = objectOf(option);
    if (found) return found;
  }
  return undefined;
}

function fieldsOf(schema: Schema | undefined, depth = 0): DocField[] | undefined {
  const object = objectOf(schema);
  if (!object?.properties || depth >= MAX_DEPTH) return undefined;
  const required = new Set<string>(object.required ?? []);
  return Object.entries(object.properties as Record<string, Schema>).map(([name, field]) => {
    const nested = fieldsOf(field, depth + 1);
    return {
      name,
      type: typeOf(field),
      required: required.has(name),
      ...(field.description ? { description: oneLine(field.description) } : {}),
      ...(nested ? { fields: nested } : {}),
    };
  });
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export function deriveApiIndex(spec: Schema): ApiDocsIndex {
  const operations: DocOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {}) as [string, Schema][]) {
    if (path.includes("/internal")) continue;
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op: Schema | undefined = item[method];
      if (!op) continue;
      const description = op.description ? oneLine(op.description) : undefined;
      const success = Object.entries(op.responses ?? {}).find(([code]) =>
        code.startsWith("2"),
      )?.[1] as Schema | undefined;
      const returned = objectOf(success?.content?.["application/json"]?.schema);
      operations.push({
        method: method.toUpperCase(),
        path,
        group: (op.tags?.[0] ?? "Other").replace(/ V\d+$/, ""),
        summary: op.summary ?? op.operationId ?? path,
        ...(description ? { description } : {}),
        ...(description?.match(/Requires ([a-z_]+:[a-z]+) scope/)
          ? { scope: description.match(/Requires ([a-z_]+:[a-z]+) scope/)![1] }
          : {}),
        params: ((op.parameters ?? []) as Schema[]).map((param) => ({
          name: param.name,
          in: param.in,
          type: typeOf(param.schema),
          required: Boolean(param.required),
          ...(param.description ? { description: oneLine(param.description) } : {}),
        })),
        ...(op.requestBody
          ? { body: fieldsOf(op.requestBody.content?.["application/json"]?.schema) ?? [] }
          : {}),
        returns: Object.keys(returned?.properties ?? {}),
      });
    }
  }
  return { version: String(spec.info?.version ?? "?"), fetchedAt: Date.now(), operations };
}

export async function fetchApiIndex(): Promise<ApiDocsIndex> {
  const res = await fetch(specUrl());
  if (!res.ok) throw new Error(`Couldn't fetch the Superwall API reference (HTTP ${res.status}).`);
  return deriveApiIndex((await res.json()) as Schema);
}

function readCached(): ApiDocsIndex | undefined {
  try {
    return JSON.parse(readFileSync(cachePath(), "utf8")) as ApiDocsIndex;
  } catch {
    return undefined;
  }
}

function writeCached(index: ApiDocsIndex): void {
  const path = cachePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(index));
  renameSync(tmp, path);
}

// The reference follows the live API; a stale copy still answers when the network doesn't.
export async function loadApiIndex(
  opts: { refresh?: boolean; fetchIndex?: () => Promise<ApiDocsIndex> } = {},
): Promise<ApiDocsIndex> {
  const cached = readCached();
  if (cached && !opts.refresh && Date.now() - cached.fetchedAt < REFRESH_TTL_MS) return cached;
  try {
    const fresh = await (opts.fetchIndex ?? fetchApiIndex)();
    writeCached(fresh);
    return fresh;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

const ALIASES: Record<string, string[]> = {
  experiment: ["variant", "audience"],
  "a/b": ["variant"],
  ab: ["variant"],
  test: ["variant"],
  split: ["weights", "variant"],
  traffic: ["weights", "percentage"],
  rule: ["audience", "filter"],
  segment: ["audience"],
  placement: ["placement"],
  trigger: ["placement"],
  subscriber: ["user"],
  customer: ["user"],
  analytics: ["query", "chart"],
  sql: ["query"],
  revenue: ["chart"],
  sku: ["product"],
};

const segments = (path: string): string[] => path.split("/").filter(Boolean);

export function matchesPath(template: string, concrete: string): boolean {
  const t = segments(template);
  const c = segments(concrete.split("?")[0]!);
  return t.length === c.length && t.every((part, i) => part.startsWith("{") || part === c[i]);
}

function score(op: DocOperation, terms: string[]): number {
  let total = 0;
  for (const term of terms) {
    const words = [term, ...(ALIASES[term] ?? [])];
    const best = Math.max(
      ...words.map((word) => {
        if (op.summary.toLowerCase().includes(word)) return 4;
        if (op.path.toLowerCase().includes(word)) return 3;
        if (op.group.toLowerCase().includes(word)) return 2;
        if (op.description?.toLowerCase().includes(word)) return 1;
        return 0;
      }),
    );
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export function searchOperations(index: ApiDocsIndex, query: string): DocOperation[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return index.operations
    .map((op) => ({ op, score: score(op, terms) }))
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.op.path.localeCompare(b.op.path) ||
        METHODS.indexOf(a.op.method) - METHODS.indexOf(b.op.method),
    )
    .map((hit) => hit.op);
}

export function findOperations(index: ApiDocsIndex, path: string, method?: string): DocOperation[] {
  return index.operations.filter(
    (op) => matchesPath(op.path, path) && (!method || op.method === method.toUpperCase()),
  );
}

const line = (op: DocOperation): string => `${op.method.padEnd(6)} ${op.path}  — ${op.summary}`;

function renderFields(fields: DocField[], indent = "  "): string[] {
  return fields.flatMap((field) => [
    `${indent}${field.name}${field.required ? "" : "?"}: ${field.type}${field.description ? `  — ${field.description}` : ""}`,
    ...renderFields(field.fields ?? [], `${indent}  `),
  ]);
}

export function renderOperation(op: DocOperation): string {
  const out = [
    `${op.method} ${op.path}`,
    `${op.summary} · ${op.group}${op.scope ? ` · needs ${op.scope}` : ""}`,
  ];
  if (op.description) out.push("", op.description);
  const path = op.params.filter((param) => param.in === "path");
  const query = op.params.filter((param) => param.in === "query");
  if (path.length) out.push("", "Path:", ...renderFields(path));
  if (query.length) out.push("", "Query:", ...renderFields(query));
  if (op.body)
    out.push("", "Body (JSON):", ...(op.body.length ? renderFields(op.body) : ["  (empty)"]));
  if (op.returns.length) out.push("", `Returns: ${op.returns.join(", ")}`);
  out.push(
    "",
    `Call it: superwall ${op.method.toLowerCase()} ${op.path}${op.body?.length ? " -d field=value …" : ""}`,
  );
  return out.join("\n");
}

export function renderApiDocs(index: ApiDocsIndex, query = "", method?: string): string {
  const header = `Superwall API ${index.version} — ${index.operations.length} endpoints`;
  const q = query.trim();
  if (!q) {
    const groups = new Map<string, number>();
    for (const op of index.operations) groups.set(op.group, (groups.get(op.group) ?? 0) + 1);
    return [
      header,
      "",
      ...[...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([group, n]) => `  ${group} (${n})`),
      "",
      "Search: superwall api docs <words>   e.g. `api docs variant`, `api docs campaign placement`",
      "Detail: superwall api docs <path> [method]   e.g. `api docs /v2/campaigns/{id}/audiences post`",
    ].join("\n");
  }
  const [first, ...rest] = q.split(/\s+/);
  if (/^(get|post|put|patch|delete)$/i.test(first!) && rest[0]?.startsWith("/")) {
    return renderApiDocs(index, rest.join(" "), first);
  }
  if (q.startsWith("/")) {
    const ops = findOperations(index, q, method);
    if (ops.length === 0)
      return `${header}\n\nNo endpoint matches ${q}. Search instead: superwall api docs <words>.`;
    return ops.map(renderOperation).join("\n\n────────\n\n");
  }
  const hits = searchOperations(index, q);
  if (hits.length === 0)
    return `${header}\n\nNothing matches "${q}". Run \`superwall api docs\` for every group.`;
  if (hits.length === 1) return renderOperation(hits[0]!);
  const shown = hits.slice(0, SEARCH_HITS);
  return [
    `${hits.length} endpoints match "${q}":`,
    "",
    ...shown.map(line),
    ...(hits.length > shown.length
      ? [`… ${hits.length - shown.length} more — add a word to narrow it`]
      : []),
    "",
    "Detail: superwall api docs <path> [method]",
  ].join("\n");
}
