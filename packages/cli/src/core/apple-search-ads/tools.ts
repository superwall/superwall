import type { CatalogTool, JsonSchema } from "@/program/command";
import { asaActions, asaGroups, asaVariants, placeholdersOf, type AsaFlag } from "./catalog";

const POSITIONAL: Record<string, { name: string; schema: JsonSchema }> = {
  id: { name: "id", schema: { type: "string", description: "The id" } },
  ids: { name: "ids", schema: { type: "string", description: "One id, or several separated by commas" } },
  query: { name: "query", schema: { type: "string", description: "What to search for" } },
  "adam-id": { name: "adam_id", schema: { type: "string", description: "The App Store app id (adamId)" } },
};

const PLACEHOLDER: Record<string, { name: string; describe: string }> = {
  campaign: { name: "campaign", describe: "Campaign id" },
  adgroup: { name: "adgroup", describe: "Ad group id" },
  adamId: { name: "adam_id", describe: "App Store app id (adamId)" },
};

function schemaOfFlag(flag: AsaFlag): JsonSchema {
  if (flag.type === "boolean") return { type: "boolean", description: flag.describe };
  if (flag.type === "number") return { type: "number", description: flag.describe };
  if (flag.type === "list") return { type: "array", items: { type: "string" }, description: flag.describe };
  if (flag.type === "money") return { type: "string", description: `${flag.describe} (an amount, in the account's currency unless currency is given)` };
  return { type: "string", description: flag.describe };
}

const QUERY: Record<string, JsonSchema> = {
  fields: { type: "string", description: "Comma-separated fields to return" },
  field: { type: "string", description: "Selector shorthand: field name (with op and values)" },
  op: { type: "string", description: "Selector shorthand: EQUALS, IN, CONTAINS, STARTSWITH, ..." },
  values: { type: "string", description: "Selector shorthand: comma-separated values" },
  "order-by": { type: "string", description: "Selector sort: field[:asc|desc]" },
  name: { type: "string", description: "Name to filter by" },
  states: { type: "string", description: "Comma-separated states" },
  country: { type: "string", description: "Country code" },
  entity: { type: "string", enum: ["Country", "AdminArea", "Locality"], description: "What kind of place to search for" },
  countries: { type: "string", description: "Comma-separated country codes" },
  "device-classes": { type: "string", description: "Comma-separated device classes" },
  "language-codes": { type: "string", description: "Comma-separated language codes" },
  expand: { type: "boolean", description: "Include nested versions" },
  owned: { type: "boolean", description: "Only apps this org owns" },
  "include-deleted-assets": { type: "boolean", description: "Include deleted assets" },
};

const snake = (flag: string) => flag.replace(/-/g, "_");

function toolOf(group: string, action: string): CatalogTool {
  const variants = asaVariants(group, action);
  const [first] = variants;
  const properties: Record<string, JsonSchema> = {
    app: { type: "string", description: "The Superwall app whose Apple Search Ads account to use, when several have it connected" },
    org_id: { type: "string", description: "Apple Search Ads org id, when the API user spans several" },
  };
  const positionals: string[] = [];
  const required: string[] = [];
  const positional = first?.positional ? POSITIONAL[first.positional] : undefined;
  if (positional) {
    properties[positional.name] = positional.schema;
    positionals.push(positional.name);
    if (variants.every((variant) => variant.positional === first?.positional)) required.push(positional.name);
  }
  for (const placeholder of first ? placeholdersOf(first.path) : []) {
    const named = PLACEHOLDER[placeholder];
    if (named && variants.every((variant) => placeholdersOf(variant.path).includes(placeholder))) required.push(named.name);
  }
  for (const variant of variants) {
    for (const placeholder of placeholdersOf(variant.path)) {
      const named = PLACEHOLDER[placeholder];
      if (named && !properties[named.name]) properties[named.name] = { type: "string", description: named.describe };
    }
    for (const flag of variant.flags ?? []) properties[snake(flag.flag)] ??= schemaOfFlag(flag);
    for (const name of variant.query ?? []) {
      const schema = QUERY[name];
      if (schema) properties[snake(name)] ??= schema;
    }
    if (variant.body === "object" || variant.body === "array") {
      properties.body = { type: ["object", "array"], description: "The whole request body, as Apple documents it" };
    }
    if (variant.body === "selector" || variant.body === "report") {
      properties.selector = { type: "object", description: "An Apple selector: conditions, orderBy, pagination" };
    }
    if (variant.body === "report") {
      properties.start = { type: "string", description: "First day, YYYY-MM-DD" };
      properties.end = { type: "string", description: "Last day, YYYY-MM-DD" };
      properties.time_zone = { type: "string", enum: ["UTC", "ORTZ"], description: "Report time zone" };
      required.push("start", "end");
    }
    if (variant.body === "geo") {
      properties.entity = { type: "string", enum: ["Country", "AdminArea", "Locality"], description: "What kind of place the ids are" };
      required.push("entity");
    }
    if (variant.paged) {
      properties.limit = { type: "number", description: "Page size" };
      properties.offset = { type: "number", description: "Page offset" };
      properties.all = { type: "boolean", description: "Walk every page" };
    }
    if (variant.flags?.some((flag) => flag.type === "money")) properties.currency = { type: "string", description: "Currency for amounts" };
    if (variant.level === "adgroup") {
      properties.adgroup_level = { type: "boolean", description: "Ad group negative keywords instead of the campaign's" };
    }
  }
  const method = first?.method ?? "GET";
  return {
    words: [group, action],
    summary: variants.map((variant) => variant.summary).join("; "),
    details: `Apple's schema for it: the asa_docs tool with "${group} ${action}".`,
    positionals,
    input: { properties, required: [...new Set(required)] },
    effect: method === "DELETE" || action === "delete" ? "destructive" : method === "GET" || action === "find" || group === "reports" ? "read" : "write",
  };
}

export async function listAsaTools(): Promise<CatalogTool[]> {
  return asaGroups().flatMap((group) => asaActions(group).map((action) => toolOf(group, action)));
}
