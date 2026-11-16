import { type CommandContext } from "@/program/command";
import { asaGroups } from "@/core/apple-search-ads/catalog";
import { apiCall } from "@/ui/spinner";
import {
  APPLE_DOCS_BASE,
  ASA_OPERATIONS,
  appleDocUrl,
  asaActions,
  asaVariants,
  placeholdersOf,
  type AsaOperation,
} from "./catalog";

export const APPLE_DOC_DATA_BASE =
  "https://developer.apple.com/tutorials/data/documentation/apple-ads-platform-api";

type DocFetcher = (url: string) => Promise<unknown>;

async function downloadAppleDoc(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function usageOf(op: AsaOperation): string {
  const parts = [`superwall asa ${op.group}`];
  if (!(op.group === "me" || (op.group === "acls" && op.action === "list"))) parts.push(op.action);
  if (op.positional === "id") parts.push("<id>");
  if (op.positional === "ids") parts.push("<id[,id...]>");
  if (op.positional === "query") parts.push("<query>");
  if (op.positional === "adam-id") parts.push("<adam-id>");
  if (placeholdersOf(op.path).includes("adamId") && op.positional !== "adam-id") parts.push("--adam-id <id>");
  for (const filter of op.filters ?? []) {
    if (filter.flag === "id" || (filter.flag === "adam-id" && op.positional === "adam-id")) continue;
    parts.push(filter.required ? `--${filter.flag} <id>` : `[--${filter.flag} <id>]`);
  }
  return parts.join(" ");
}

function flagLines(op: AsaOperation): string[] {
  const lines: string[] = [];
  for (const f of op.flags ?? []) {
    const value =
      f.type === "boolean"
        ? ""
        : f.type === "money"
          ? " <amount>"
          : f.type === "list"
            ? " <a,b,c>"
            : f.type === "number"
              ? " <n>"
              : " <value>";
    lines.push(`  --${f.flag}${value}  ${f.describe} → \`${f.key}\``);
  }
  if (op.body === "object" || op.body === "bulk") {
    lines.push("  -d key=value / key:=json  Extra body fields (nesting via key[sub])");
    lines.push("  --body <json|@file|@->  Full request body (bulk: an array of items), merged under flags");
  }
  if (op.body === "array") lines.push("  --body <json|@file|@->  The request body: an array, as Apple documents it");
  if (op.body === "query" || op.body === "report") {
    lines.push("  --query <json|@file|@->  Full Apple query request: filters, sorting, pagination");
    lines.push("  --field <f> --op <OP> --values <a,b>  One-filter shorthand");
    lines.push("  --order-by <field[:asc|desc]>  Sort");
  }
  if (op.body === "report") {
    lines.push("  --start <YYYY-MM-DD> --end <YYYY-MM-DD>  Report range");
    lines.push("  --granularity <HOURLY|DAILY|WEEKLY|MONTHLY>  Rows per period (default DAILY)");
    lines.push("  --group-by <a,b>  Group rows by dimension");
    lines.push("  --fields <a,b>  Only these fields");
    if (op.zoned) lines.push("  --time-zone <UTC|ORTZ>  Report time zone (default UTC)");
  }
  if (op.body === "geo") {
    lines.push("  --entity <Country|AdminArea|Locality>  Entity type for each id");
    lines.push("  --supply-source <APPSTORE|MAPS>  Supply source (default APPSTORE)");
  }
  if (op.paged) lines.push("  --limit <n> --offset <n> --all  Paging (--all walks every page)");
  if (op.query?.includes("owned")) lines.push("  --owned  Only apps this account owns");
  if (op.query?.includes("store-fronts")) lines.push("  --store-fronts <a,b>  Restrict to storefronts");
  if (op.query?.includes("country")) lines.push("  --country <CC>  Restrict to a country code");
  if (op.query?.includes("entity")) lines.push("  --entity <Country|AdminArea|Locality>");
  if (op.query?.includes("supply-source")) lines.push("  --supply-source <APPSTORE|MAPS>  Supply source (default APPSTORE)");
  if (op.query?.includes("eligible")) lines.push("  --eligible  Only places that can be targeted");
  if (op.query?.includes("resource-type")) lines.push("  --resource-type <type>  e.g. CONTENT_PROVIDER");
  return lines;
}

export function renderAsaCatalog(): string {
  const lines = ["# Apple Search Ads — `superwall asa`", ""];
  lines.push("Every Apple Ads Platform API v1 endpoint, through Superwall's proxy.");
  lines.push("`superwall asa docs <group>` lists a group, `superwall asa docs <group> <action>` fetches Apple's page.");
  lines.push("");
  for (const group of asaGroups()) {
    lines.push(`## ${group}`);
    for (const action of asaActions(group)) {
      const variants = asaVariants(group, action);
      const [first] = variants;
      if (!first) continue;
      const paths = variants.map((v) => `${v.method} ${v.path}`).join(" | ");
      lines.push(`- \`${usageOf(first)}\` — ${first.summary}  (${paths})`);
    }
    lines.push("");
  }
  lines.push("Raw: `superwall asa get|post|put|delete /path [-d k=v] [--body json]`, or `superwall asa /path`.");
  return lines.join("\n").trimEnd();
}

export function renderAsaGroup(group: string): string {
  const lines = [`# asa ${group}`, ""];
  for (const action of asaActions(group)) {
    for (const v of asaVariants(group, action)) {
      lines.push(`## ${usageOf(v)}`);
      lines.push(`${v.summary}`);
      lines.push(`\`${v.method} ${v.path}\` — ${appleDocUrl(v)}`);
      const flags = flagLines(v);
      if (flags.length) lines.push("", ...flags);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

export function searchAsaCatalog(query: string): AsaOperation[] {
  const q = query.toLowerCase();
  return ASA_OPERATIONS.filter((o) => {
    return (
      o.group.includes(q) ||
      o.action.includes(q) ||
      o.summary.toLowerCase().includes(q) ||
      o.path.toLowerCase().includes(q)
    );
  });
}

export function renderAsaSearch(query: string): string {
  const hits = searchAsaCatalog(query);
  if (hits.length === 0) return `No Apple Search Ads endpoint matches "${query}". Run \`superwall asa docs\` for the catalog.`;
  const lines = [`# Endpoints matching "${query}"`, ""];
  for (const v of hits) lines.push(`- \`${usageOf(v)}\` — ${v.summary}  (${v.method} ${v.path})`);
  return lines.join("\n");
}

type Node = Record<string, unknown>;

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function inlineText(nodes: unknown, refs: Node): string {
  return asArray(nodes)
    .map((n) => {
      if (!isNode(n)) return "";
      switch (n.type) {
        case "text":
          return str(n.text);
        case "codeVoice":
          return `\`${str(n.code)}\``;
        case "reference": {
          const ref = refs[str(n.identifier)];
          return isNode(ref) ? str(ref.title) : "";
        }
        case "emphasis":
        case "strong":
          return inlineText(n.inlineContent, refs);
        default:
          return "";
      }
    })
    .join("");
}

function blockText(nodes: unknown, refs: Node): string[] {
  const out: string[] = [];
  for (const n of asArray(nodes)) {
    if (!isNode(n)) continue;
    switch (n.type) {
      case "paragraph":
        out.push(inlineText(n.inlineContent, refs));
        break;
      case "heading":
        out.push(`### ${str(n.text)}`);
        break;
      case "codeListing":
        out.push("```", ...asArray(n.code).map(str), "```");
        break;
      case "unorderedList":
      case "orderedList":
        for (const item of asArray(n.items)) {
          if (!isNode(item)) continue;
          out.push(...blockText(item.content, refs).map((l) => `- ${l}`));
        }
        break;
      case "tabNavigator":
        for (const tab of asArray(n.tabs)) {
          if (!isNode(tab)) continue;
          out.push(`**${str(tab.title)}**`, ...blockText(tab.content, refs));
        }
        break;
      case "table":
        for (const row of asArray(n.rows)) {
          out.push(
            asArray(row)
              .map((cell) => blockText(cell, refs).join(" "))
              .join(" | "),
          );
        }
        break;
      default:
        break;
    }
  }
  return out.filter((l) => l !== "");
}

function tokenText(tokens: unknown): string {
  return asArray(tokens)
    .map((t) => (isNode(t) ? str(t.text) : ""))
    .join("");
}

function parameterLines(items: unknown, refs: Node): string[] {
  const out: string[] = [];
  for (const item of asArray(items)) {
    if (!isNode(item)) continue;
    const name = str(item.name);
    const type = tokenText(item.type);
    const required = item.required === true ? " (required)" : "";
    const attrs = asArray(item.attributes)
      .map((a) => {
        if (!isNode(a)) return "";
        if (a.kind === "default") return `default ${str(a.value)}`;
        if (a.kind === "allowedValues") return `one of ${asArray(a.values).map(str).join(", ")}`;
        if (a.kind === "minimum") return `min ${str(a.value)}`;
        if (a.kind === "maximum") return `max ${str(a.value)}`;
        return "";
      })
      .filter(Boolean);
    const desc = blockText(item.content, refs).join(" ");
    const meta = [type, ...attrs].filter(Boolean).join(", ");
    out.push(`- \`${name}\`${required}${meta ? ` — ${meta}` : ""}${desc ? `: ${desc}` : ""}`);
  }
  return out;
}

export function renderAppleDoc(doc: unknown, body?: string): string {
  if (!isNode(doc)) return "";
  const refs = isNode(doc.references) ? doc.references : {};
  const metadata = isNode(doc.metadata) ? doc.metadata : {};
  const lines: string[] = [];
  const title = str(metadata.title);
  if (title) lines.push(`# ${title}`);
  const abstract = inlineText(doc.abstract, refs);
  if (abstract) lines.push(abstract);
  for (const section of asArray(doc.primaryContentSections)) {
    if (!isNode(section)) continue;
    switch (section.kind) {
      case "restEndpoint":
        lines.push("", `\`${tokenText(section.tokens)}\``);
        break;
      case "restParameters": {
        const params = parameterLines(section.items, refs);
        if (params.length) lines.push("", `## ${str(section.title)}`, ...params);
        break;
      }
      case "restBody": {
        const type = tokenText(section.bodyContentType);
        const desc = blockText(section.content, refs).join(" ");
        lines.push("", "## HTTP Body");
        const typeLine = `${type ? `\`${type}\`` : ""}${desc ? ` — ${desc}` : ""}`.trim();
        if (typeLine) lines.push(typeLine);
        lines.push(...parameterLines(section.parameters, refs));
        if (body) lines.push("", body);
        break;
      }
      case "restResponses": {
        const items = asArray(section.items)
          .map((item) => {
            if (!isNode(item)) return "";
            const type = tokenText(item.type);
            const desc = blockText(item.content, refs).join(" ");
            return `- ${String(item.status)} ${str(item.reason)}${type ? ` \`${type}\`` : ""}${desc ? ` — ${desc}` : ""}`;
          })
          .filter(Boolean);
        if (items.length) lines.push("", "## Responses", ...items);
        break;
      }
      case "properties": {
        const params = parameterLines(section.items, refs);
        if (params.length) lines.push("", "## Properties", ...params);
        break;
      }
      case "content":
        lines.push("", ...blockText(section.content, refs));
        break;
      default:
        break;
    }
  }
  return lines.join("\n").trim();
}

function bodyTypeIdentifier(doc: unknown): string | undefined {
  if (!isNode(doc)) return undefined;
  for (const section of asArray(doc.primaryContentSections)) {
    if (!isNode(section) || section.kind !== "restBody") continue;
    for (const t of asArray(section.bodyContentType)) {
      if (isNode(t) && t.kind === "typeIdentifier") {
        const identifier = str(t.identifier);
        const slug = identifier.split("/").pop();
        if (slug) return slug;
      }
    }
  }
  return undefined;
}

async function bodyDocs(doc: unknown, fetchDoc: DocFetcher): Promise<string | undefined> {
  const bodyType = bodyTypeIdentifier(doc);
  if (!bodyType) return undefined;
  try {
    return renderAppleDoc(await fetchDoc(`${APPLE_DOC_DATA_BASE}/${bodyType.toLowerCase()}.json`));
  } catch (error) {
    return `Couldn't fetch the \`${bodyType}\` object page (${describe(error)}) — see ${APPLE_DOCS_BASE}/${bodyType.toLowerCase()}.`;
  }
}

export async function renderAsaOperationDocs(
  group: string,
  action: string,
  fetchDoc: DocFetcher = downloadAppleDoc,
): Promise<string> {
  const variants = asaVariants(group, action);
  if (variants.length === 0) {
    throw new Error(`Unknown "asa ${group} ${action}". Run \`superwall asa docs ${group}\` for its actions.`);
  }
  const lines: string[] = [];
  for (const v of variants) {
    lines.push(`## ${usageOf(v)}`, v.summary, `\`${v.method} ${v.path}\``);
    const flags = flagLines(v);
    if (flags.length) lines.push("", ...flags);
    lines.push("", `Apple: ${appleDocUrl(v)}`);
    const url = `${APPLE_DOC_DATA_BASE}/${v.doc}.json`;
    try {
      const doc = await fetchDoc(url);
      lines.push("", renderAppleDoc(doc, await bodyDocs(doc, fetchDoc)));
    } catch (error) {
      lines.push("", `Couldn't fetch Apple's page (${describe(error)}) — read it at ${appleDocUrl(v)}.`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function renderDocs(ctx: CommandContext, resource: string | undefined, operation: string | undefined): Promise<string> {
  if (!resource) return renderAsaCatalog();
  if (operation) {
    return await apiCall(ctx, "Fetching Apple's documentation", () => renderAsaOperationDocs(resource, operation));
  }
  if (asaGroups().includes(resource)) return renderAsaGroup(resource);
  return renderAsaSearch(resource);
}
