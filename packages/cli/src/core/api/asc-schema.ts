import { type AscOperation, type Field, readCachedIndex } from "./asc-index";

export type { AscOperation };

function index() {
  return readCachedIndex();
}

function segments(path: string): string[] {
  return path.split("?")[0]!.split("/").filter(Boolean);
}

function matches(tmpl: string[], concrete: string[]): boolean {
  if (tmpl.length !== concrete.length) return false;
  return tmpl.every(
    (s, i) => s.startsWith("{") || concrete[i]!.startsWith("{") || s === concrete[i],
  );
}

export function lookupAscOp(
  method: string,
  rawPath: string,
): { path: string; op: AscOperation } | undefined {
  const m = method.toLowerCase();
  const concrete = segments(rawPath);
  for (const [tmpl, ops] of Object.entries(index().paths)) {
    if (ops[m] && matches(segments(tmpl), concrete)) return { path: tmpl, op: ops[m]! };
  }
  return undefined;
}

function castAttr(field: Field | undefined, v: unknown): unknown {
  if (typeof v !== "string" || !field) return v;
  if (field.type === "boolean") {
    if (v === "true") return true;
    if (v === "false") return false;
  }
  if ((field.type === "integer" || field.type === "number") && v.trim() !== "") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return v;
}

function lastId(rawPath: string): string | undefined {
  const segs = segments(rawPath);
  const last = segs[segs.length - 1];
  return last && !last.startsWith("{") ? last : undefined;
}

export function buildAscBody(
  op: AscOperation,
  method: string,
  rawPath: string,
  flat: Record<string, unknown>,
): Record<string, unknown> {
  if (!op.dataType) return flat;
  if (flat.data && typeof flat.data === "object") return flat;

  const attributes: Record<string, unknown> = {};
  const relationships: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    const rel = op.relationships?.[k];
    if (rel) {
      const ids = rel.many ? (Array.isArray(v) ? v : [v]) : v;
      relationships[k] = {
        data: rel.many
          ? (ids as unknown[]).map((id) => ({ type: rel.target, id: String(id) }))
          : { type: rel.target, id: String(ids) },
      };
    } else {
      attributes[k] = castAttr(op.attributes?.[k], v);
    }
  }

  const data: Record<string, unknown> = { type: op.dataType };
  if (method.toLowerCase() === "patch") {
    const id = lastId(rawPath);
    if (id) data.id = id;
  }
  if (Object.keys(attributes).length) data.attributes = attributes;
  if (Object.keys(relationships).length) data.relationships = relationships;
  return { data };
}

export function validateAscBody(
  op: AscOperation,
  method: string,
  body: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  const data = (body.data ?? {}) as Record<string, unknown>;
  const attrs = (data.attributes ?? {}) as Record<string, unknown>;
  const rels = (data.relationships ?? {}) as Record<string, unknown>;
  const isPatch = method.toLowerCase() === "patch";

  for (const [name, f] of Object.entries(op.attributes ?? {})) {
    if (f.required && !isPatch && !(name in attrs))
      problems.push(`missing required attribute: ${name}`);
    const val = attrs[name];
    if (f.enum && typeof val === "string" && !f.enum.includes(val))
      problems.push(`${name} "${val}" not allowed — use ${f.enum.join("|")}`);
  }
  for (const [name, r] of Object.entries(op.relationships ?? {})) {
    if (r.required && !isPatch && !(name in rels))
      problems.push(`missing required relationship: ${name}${r.target ? ` → ${r.target}` : ""}`);
  }
  return problems;
}

function exampleInvocation(method: string, path: string, op: AscOperation): string {
  const parts = [`superwall asc ${method.toLowerCase()} ${path}`];
  for (const [name, f] of Object.entries(op.attributes ?? {})) {
    if (!f.required) continue;
    parts.push(`-d ${name}=${f.enum ? f.enum[0] : `<${f.type ?? "value"}>`}`);
  }
  for (const [name, r] of Object.entries(op.relationships ?? {})) {
    if (r.required) parts.push(`-d ${name}=<${r.target ?? "id"} id>`);
  }
  return parts.join(" ");
}

function renderOp(method: string, path: string, op: AscOperation): string {
  const lines: string[] = [];
  lines.push(`### ${method.toUpperCase()} ${path}`);
  if (op.summary) lines.push(op.summary);
  if (op.deprecated) lines.push("> ⚠ Deprecated in the App Store Connect API.");
  const attrs = Object.entries(op.attributes ?? {});
  const rels = Object.entries(op.relationships ?? {});
  if (op.dataType) lines.push("", `Body → \`data.type: ${op.dataType}\``);
  if (attrs.length) {
    lines.push("", "Attributes:");
    for (const [name, f] of attrs) {
      const kind = f.enum ? f.enum.join("|") : (f.type ?? "");
      lines.push(`  - ${name}  ${kind}${f.required ? "  (required)" : ""}`);
    }
  }
  if (rels.length) {
    lines.push("", "Relationships:");
    for (const [name, r] of rels)
      lines.push(
        `  - ${name} → ${r.target ?? "?"}${r.many ? "[]" : ""}${r.required ? "  (required)" : ""}`,
      );
  }
  if (op.query?.length) lines.push("", `Query: ${op.query.map((q) => `\`${q}\``).join(", ")}`);
  lines.push("", "Example:", `  ${exampleInvocation(method, path, op)}`);
  return lines.join("\n");
}

export function renderAscDocs(query: string, verb?: string): string {
  const idx = index();
  const header = `App Store Connect API — spec ${idx.specVersion}\n`;

  if (!query.trim()) {
    const roots = new Set<string>();
    for (const tmpl of Object.keys(idx.paths)) if (segments(tmpl).length === 2) roots.add(tmpl);
    const list = [...roots].sort();
    return (
      `${header}\n${list.length} top-level resources. ` +
      "Run `asc docs <path> [verb]` for a schema, or `asc docs <search term>` to filter.\n\n" +
      list.join("\n")
    );
  }

  if (query.startsWith("/")) {
    const concrete = segments(query);
    const out: string[] = [];
    for (const [tmpl, ops] of Object.entries(idx.paths)) {
      if (!matches(segments(tmpl), concrete)) continue;
      for (const [method, op] of Object.entries(ops)) {
        if (verb && method !== verb.toLowerCase()) continue;
        out.push(renderOp(method, tmpl, op));
      }
    }
    if (!out.length)
      return `${header}\nNo operation matches ${query}. Try \`asc docs <search term>\`.`;
    return `${header}\n${out.join("\n\n")}`;
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: string[] = [];
  for (const [tmpl, ops] of Object.entries(idx.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const hay = `${tmpl} ${op.summary ?? ""} ${op.opId ?? ""}`.toLowerCase();
      if (terms.every((t) => hay.includes(t)))
        hits.push(
          `${method.toUpperCase().padEnd(6)} ${tmpl}${op.summary ? `  — ${op.summary}` : ""}`,
        );
    }
  }
  if (!hits.length) return `${header}\nNothing matches "${query}".`;
  return `${header}\n${hits.slice(0, 60).join("\n")}${hits.length > 60 ? `\n… ${hits.length - 60} more` : ""}\n\nRun \`asc docs <path> [verb]\` for a full schema.`;
}
