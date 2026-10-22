import { cache, readJson } from "@/core/state/store";

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Field {
  required: boolean;
  type?: string;
  enum?: string[];
}
interface Relationship extends Field {
  target?: string;
  many?: boolean;
}
export interface AscOperation {
  opId?: string;
  summary?: string;
  deprecated?: boolean;
  dataType?: string;
  attributes?: Record<string, Field>;
  relationships?: Record<string, Relationship>;
  query?: string[];
}
export interface AscIndex {
  specVersion: string;
  openapi: string;
  fetchedAt?: number;
  paths: Record<string, Record<string, AscOperation>>;
}

const CACHE_FILE = "asc-index.json";

let mem: AscIndex | undefined;
let refresh: () => void = () => {};

export function useAscRefresh(start: () => void): void {
  refresh = start;
}

export function findCachedIndex(): AscIndex | undefined {
  return (mem ??= readJson<AscIndex>(cache(), CACHE_FILE));
}

export function readCachedIndex(): AscIndex {
  const index = findCachedIndex();
  if (!index) throw new Error("No App Store Connect schema yet. Run `superwall asc docs --refresh`.");
  return index;
}

export function forgetCachedIndex(): void {
  mem = undefined;
}

export function indexIsStale(index: AscIndex): boolean {
  return !index.fetchedAt || Date.now() - index.fetchedAt > REFRESH_TTL_MS;
}

export function writeCachedIndex(index: AscIndex): void {
  cache().write(CACHE_FILE, JSON.stringify(index));
  mem = index;
}

export function refreshInBackground(): void {
  refresh();
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipSingleJson(zip: Uint8Array): Promise<string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const u16 = (offset: number) => view.getUint16(offset, true);
  let eocd = zip.length - 22;
  while (eocd >= 0 && u32(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("App Store Connect spec: no zip directory found.");
  let entry = u32(eocd + 16);
  const count = u16(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (u32(entry) !== 0x02014b50) throw new Error("App Store Connect spec: malformed zip directory.");
    const method = u16(entry + 10);
    const compSize = u32(entry + 20);
    const nameLen = u16(entry + 28);
    const extraLen = u16(entry + 30);
    const commentLen = u16(entry + 32);
    const localOff = u32(entry + 42);
    const name = new TextDecoder().decode(zip.subarray(entry + 46, entry + 46 + nameLen));
    if (name.endsWith(".json")) {
      const start = localOff + 30 + u16(localOff + 26) + u16(localOff + 28);
      const data = zip.subarray(start, start + compSize);
      return new TextDecoder().decode(method === 0 ? data : await inflateRaw(data));
    }
    entry += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("App Store Connect spec: no JSON entry in archive.");
}

const METHODS = ["get", "post", "patch", "delete", "put"] as const;

function deriveIndex(spec: any): AscIndex {
  const schemas: Record<string, any> = spec.components?.schemas ?? {};
  const deref = (node: any): any => {
    if (!node?.$ref) return node;
    return schemas[node.$ref.split("/").pop()];
  };

  const fields = (schema: any): Record<string, Field> => {
    const out: Record<string, Field> = {};
    if (!schema) return out;
    const required = new Set<string>(schema.required ?? []);
    for (const [name, raw] of Object.entries(schema.properties ?? {})) {
      const p = deref(raw);
      const f: Field = { required: required.has(name) };
      if (Array.isArray(p.enum)) f.enum = p.enum;
      else if (p.type) f.type = p.type;
      out[name] = f;
    }
    return out;
  };

  const relationships = (schema: any): Record<string, Relationship> => {
    const out: Record<string, Relationship> = {};
    if (!schema) return out;
    const required = new Set<string>(schema.required ?? []);
    for (const [name, raw] of Object.entries(schema.properties ?? {})) {
      const data = deref(deref(raw)?.properties?.data);
      const rel: Relationship = { required: required.has(name) };
      const ident = data?.type === "array" ? deref(data.items) : data;
      rel.many = data?.type === "array";
      const t = deref(ident?.properties?.type);
      if (Array.isArray(t?.enum)) rel.target = t.enum[0];
      out[name] = rel;
    }
    return out;
  };

  const paths: AscIndex["paths"] = {};
  for (const [path, ops] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = ops[method];
      if (!op) continue;
      const entry: AscOperation = {
        opId: op.operationId,
        summary: op.summary,
        ...(op.deprecated ? { deprecated: true } : {}),
      };
      const bodySchema = deref(deref(op.requestBody)?.content?.["application/json"]?.schema);
      if (bodySchema) {
        const data = deref(bodySchema.properties?.data);
        const type = deref(data?.properties?.type);
        if (Array.isArray(type?.enum)) entry.dataType = type.enum[0];
        const attrs = fields(deref(data?.properties?.attributes));
        const rels = relationships(deref(data?.properties?.relationships));
        if (Object.keys(attrs).length) entry.attributes = attrs;
        if (Object.keys(rels).length) entry.relationships = rels;
      }
      const query = (op.parameters ?? [])
        .map(deref)
        .filter((p: any) => p?.in === "query")
        .map((p: any) => p.name);
      if (query.length) entry.query = query;
      (paths[path] ??= {})[method] = entry;
    }
  }

  return {
    specVersion: String(spec.info?.version ?? "unknown"),
    openapi: String(spec.openapi ?? "unknown"),
    paths,
  };
}

export async function downloadAscIndex(): Promise<AscIndex> {
  const res = await fetch(
    "https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip",
  );
  if (!res.ok)
    throw new Error(
      `Couldn't fetch the App Store Connect schema (HTTP ${res.status}). Check your connection and retry.`,
    );
  const spec = JSON.parse(await unzipSingleJson(new Uint8Array(await res.arrayBuffer())));
  const index = deriveIndex(spec);
  index.fetchedAt = Date.now();
  return index;
}
