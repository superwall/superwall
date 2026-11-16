import type { CatalogTool, JsonSchema } from "@/program/command";
import { asaActions, asaGroups, asaVariants, placeholdersOf, type AsaFlag } from "./catalog";

const POSITIONAL: Record<string, { name: string; schema: JsonSchema }> = {
  id: { name: "id", schema: { type: "string", description: "The id" } },
  ids: { name: "ids", schema: { type: "string", description: "One id, or several separated by commas" } },
  query: { name: "query", schema: { type: "string", description: "What to search for" } },
  "adam-id": { name: "adam_id", schema: { type: "string", description: "The App Store app id (adamId)" } },
};

const SCOPE: Record<string, { name: string; describe: string }> = {
  campaign: { name: "campaign", describe: "Campaign id" },
  adgroup: { name: "adgroup", describe: "Ad group id" },
  "adam-id": { name: "adam_id", describe: "App Store app id (adamId)" },
};

function schemaOfFlag(flag: AsaFlag): JsonSchema {
  if (flag.type === "boolean") return { type: "boolean", description: flag.describe };
  if (flag.type === "number") return { type: "number", description: flag.describe };
  if (flag.type === "list") return { type: "array", items: { type: "string" }, description: flag.describe };
  if (flag.type === "money") return { type: "string", description: `${flag.describe} (an amount, in the account's currency unless currency is given)` };
  return { type: "string", description: flag.describe };
}

const SUPPLY_SOURCE: JsonSchema = { type: "string", enum: ["APPSTORE", "MAPS"], description: "Supply source (default APPSTORE)" };

const QUERY: Record<string, JsonSchema> = {
  owned: { type: "boolean", description: "Only apps this account owns" },
  "store-fronts": { type: "string", description: "Comma-separated storefronts" },
  country: { type: "string", description: "Country code" },
  entity: { type: "string", enum: ["Country", "AdminArea", "Locality"], description: "What kind of place to search for" },
  "supply-source": SUPPLY_SOURCE,
  eligible: { type: "boolean", description: "Only places that can be targeted" },
  "resource-type": { type: "string", description: "Advertiser resource type, e.g. CONTENT_PROVIDER" },
};

const QUERY_BODY: Record<string, JsonSchema> = {
  query: { type: "object", description: "An Apple query request: filters, sorting, pagination" },
  field: { type: "string", description: "Filter shorthand: field name (with op and values)" },
  op: { type: "string", description: "Filter shorthand: EQUALS, IN, LIKE, STARTS_WITH, BETWEEN, ..." },
  values: { type: "string", description: "Filter shorthand: comma-separated values" },
  order_by: { type: "string", description: "Sort: field[:asc|desc]" },
};

const snake = (flag: string) => flag.replace(/-/g, "_");

function toolOf(group: string, action: string): CatalogTool {
  const variants = asaVariants(group, action);
  const [first] = variants;
  const properties: Record<string, JsonSchema> = {
    app: { type: "string", description: "The Superwall app whose Apple Search Ads account to use, when several have it connected" },
    ad_account_id: { type: "string", description: "Apple Ads ad account id, when the API user reaches several" },
  };
  const positionals: string[] = [];
  const required: string[] = [];
  const positional = first?.positional ? POSITIONAL[first.positional] : undefined;
  if (positional) {
    properties[positional.name] = positional.schema;
    positionals.push(positional.name);
    const bulkBody = variants.some((variant) => variant.body === "bulk");
    if (!bulkBody && variants.every((variant) => variant.positional === first?.positional)) required.push(positional.name);
  }
  for (const variant of variants) {
    if (placeholdersOf(variant.path).includes("adamId") && variant.positional !== "adam-id") {
      properties.adam_id ??= { type: "string", description: "App Store app id (adamId)" };
      required.push("adam_id");
    }
    for (const filter of variant.filters ?? []) {
      const scope = SCOPE[filter.flag];
      if (!scope) continue;
      properties[scope.name] ??= { type: "string", description: `${scope.describe}: only rows for it` };
      if (filter.required) required.push(scope.name);
    }
    for (const flag of variant.flags ?? []) properties[snake(flag.flag)] ??= schemaOfFlag(flag);
    for (const name of variant.query ?? []) {
      const schema = QUERY[name];
      if (schema) properties[snake(name)] ??= schema;
    }
    if (variant.body === "object" || variant.body === "bulk" || variant.body === "array") {
      properties.body = { type: ["object", "array"], description: "The whole request body, as Apple documents it" };
    }
    if (variant.body === "array") required.push("body");
    if (variant.body === "query" || variant.body === "report") Object.assign(properties, QUERY_BODY);
    if (variant.body === "report") {
      properties.start = { type: "string", description: "First day, YYYY-MM-DD" };
      properties.end = { type: "string", description: "Last day, YYYY-MM-DD" };
      properties.granularity = { type: "string", description: "HOURLY, DAILY, WEEKLY or MONTHLY (default DAILY)" };
      properties.group_by = { type: "string", description: "Comma-separated dimensions, e.g. countryOrRegion" };
      properties.fields = { type: "string", description: "Comma-separated fields to return" };
      if (variant.zoned) properties.time_zone = { type: "string", enum: ["UTC", "ORTZ"], description: "Report time zone (default UTC)" };
      required.push("start", "end");
    }
    if (variant.body === "geo") {
      properties.entity = { type: "string", enum: ["Country", "AdminArea", "Locality"], description: "What kind of place the ids are" };
      properties.supply_source = SUPPLY_SOURCE;
      required.push("entity");
    }
    if (variant.paged) {
      properties.limit = { type: "number", description: "Page size" };
      properties.offset = { type: "number", description: "Page offset" };
      properties.all = { type: "boolean", description: "Walk every page" };
    }
    if (variant.flags?.some((flag) => flag.type === "money")) properties.currency = { type: "string", description: "Currency for amounts" };
  }
  const effect = variants.some((variant) => variant.effect === "destructive")
    ? "destructive"
    : variants.every((variant) => variant.effect === "read") ? "read" : "write";
  return {
    words: [group, action],
    summary: variants.map((variant) => variant.summary).join("; "),
    details: [...new Set(variants.map((variant) => variant.details).filter(Boolean)), `Apple's schema for it: the asa_docs tool with "${group} ${action}".`].join("\n\n"),
    positionals,
    input: { properties, required: [...new Set(required)] },
    effect,
  };
}

export async function listAsaTools(): Promise<CatalogTool[]> {
  return asaGroups().flatMap((group) => asaActions(group).map((action) => toolOf(group, action)));
}
