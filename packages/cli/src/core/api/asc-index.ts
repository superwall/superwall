import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SUPERWALL_HOME } from "@/environment";

export const SPEC_URL =
  "https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip";

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

function cachePath(): string {
  return (
    process.env.SUPERWALL_ASC_INDEX_PATH ??
    join(SUPERWALL_HOME() ?? join(homedir(), ".superwall"), "asc-index.json")
  );
}

let mem: AscIndex | undefined;

export function readCachedIndex(): AscIndex {
  if (mem) return mem;
  return (mem = JSON.parse(readFileSync(cachePath(), "utf8")) as AscIndex);
}

export function indexIsStale(index: AscIndex): boolean {
  return !index.fetchedAt || Date.now() - index.fetchedAt > REFRESH_TTL_MS;
}

export function writeCachedIndex(index: AscIndex): void {
  const path = cachePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(index));
  renameSync(tmp, path);
  mem = index;
}

function unzipSingleJson(zip: Buffer): Buffer {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("App Store Connect spec: no zip directory found.");
  let entry = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(entry) !== 0x02014b50)
      throw new Error("App Store Connect spec: malformed zip directory.");
    const method = zip.readUInt16LE(entry + 10);
    const compSize = zip.readUInt32LE(entry + 20);
    const nameLen = zip.readUInt16LE(entry + 28);
    const extraLen = zip.readUInt16LE(entry + 30);
    const commentLen = zip.readUInt16LE(entry + 32);
    const localOff = zip.readUInt32LE(entry + 42);
    const name = zip.toString("utf8", entry + 46, entry + 46 + nameLen);
    if (name.endsWith(".json")) {
      const lNameLen = zip.readUInt16LE(localOff + 26);
      const lExtraLen = zip.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = zip.subarray(start, start + compSize);
      return method === 0 ? data : inflateRawSync(data);
    }
    entry += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("App Store Connect spec: no JSON entry in archive.");
}

const METHODS = ["get", "post", "patch", "delete", "put"] as const;

export function deriveIndex(spec: any): AscIndex {
  const schemas: Record<string, any> = spec.components?.schemas ?? {};
  const deref = (node: any): any =>
    node && node.$ref ? schemas[node.$ref.split("/").pop()] : node;

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
        .map((p: any) => p.name as string);
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

export async function fetchAscIndex(): Promise<AscIndex> {
  const res = await fetch(SPEC_URL);
  if (!res.ok)
    throw new Error(
      `Couldn't fetch the App Store Connect schema (HTTP ${res.status}). Check your connection and retry.`,
    );
  const zip = Buffer.from(await res.arrayBuffer());
  const spec = JSON.parse(unzipSingleJson(zip).toString("utf8"));
  const index = deriveIndex(spec);
  index.fetchedAt = Date.now();
  return index;
}

export function triggerBackgroundRefresh(): void {
  if (process.env.SW_ASC_REFRESH === "1") return;
  const entry = process.argv[1];
  if (!entry) return;
  try {
    const child = spawn(process.execPath, [entry, "asc", "docs", "refresh", "--quiet"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, SW_ASC_REFRESH: "1" },
    });
    child.unref();
  } catch {
    return;
  }
}
