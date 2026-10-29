import type { ToolEffect } from "@/program/command";

type AsaMethod = "GET" | "POST" | "PUT" | "DELETE";

type AsaBody = "object" | "array" | "selector" | "report" | "ids" | "geo";

type AsaFlagType = "string" | "number" | "boolean" | "money" | "list";

export interface AsaFlag {
  flag: string;
  key: string;
  type: AsaFlagType;
  describe: string;
}

export interface AsaOperation {
  group: string;
  action: string;
  effect: Exclude<ToolEffect, false>;
  method: AsaMethod;
  path: string;
  summary: string;
  details?: string;
  doc: string;
  positional?: "id" | "ids" | "query" | "adam-id";
  body?: AsaBody;
  envelope?: string;
  flags?: AsaFlag[];
  query?: string[];
  paged?: "query" | "selector";
  level?: "adgroup";
}

export const APPLE_DOCS_BASE = "https://developer.apple.com/documentation/apple_ads";

const flag = (flag: string, key: string, type: AsaFlagType, describe: string): AsaFlag => ({
  flag,
  key,
  type,
  describe,
});

const NAME = flag("name", "name", "string", "Name");
const STATUS = flag("status", "status", "string", "ENABLED or PAUSED");
const ADAM_ID = flag("adam-id", "adamId", "number", "App Store app id (adamId)");
const MATCH_TYPE = flag("match-type", "matchType", "string", "BROAD or EXACT");
const TEXT = flag("text", "text", "string", "Keyword text");
const KEYWORD_STATUS = flag("status", "status", "string", "ACTIVE or PAUSED");
const START = flag("start", "startTime", "string", "Start (YYYY-MM-DD or ISO timestamp)");
const END = flag("end", "endTime", "string", "End (YYYY-MM-DD or ISO timestamp)");

const CAMPAIGN_FIELDS: AsaFlag[] = [
  NAME,
  ADAM_ID,
  flag("countries", "countriesOrRegions", "list", "Comma-separated country codes"),
  flag("budget", "budgetAmount", "money", "Lifetime budget"),
  flag("daily-budget", "dailyBudgetAmount", "money", "Daily budget"),
  flag("supply-sources", "supplySources", "list", "Comma-separated supply sources"),
  flag("ad-channel-type", "adChannelType", "string", "SEARCH or DISPLAY"),
  flag("billing-event", "billingEvent", "string", "TAPS or IMPRESSIONS"),
  START,
  END,
  STATUS,
];

const ADGROUP_FIELDS: AsaFlag[] = [
  NAME,
  flag("default-bid", "defaultBidAmount", "money", "Default CPT bid"),
  flag("cpa-goal", "cpaGoal", "money", "CPA goal"),
  flag("search-match", "automatedKeywordsOptIn", "boolean", "Enable Search Match"),
  START,
  END,
  STATUS,
];

const KEYWORD_FIELDS: AsaFlag[] = [
  TEXT,
  MATCH_TYPE,
  flag("bid", "bidAmount", "money", "Keyword bid"),
  KEYWORD_STATUS,
];

const NEGATIVE_FIELDS: AsaFlag[] = [TEXT, MATCH_TYPE, KEYWORD_STATUS];

const AD_FIELDS: AsaFlag[] = [NAME, flag("creative-id", "creativeId", "number", "Creative id"), STATUS];

const REPORT_FLAGS: AsaFlag[] = [
  flag("start", "startTime", "string", "Report start (YYYY-MM-DD)"),
  flag("end", "endTime", "string", "Report end (YYYY-MM-DD)"),
  flag("granularity", "granularity", "string", "HOURLY, DAILY, WEEKLY, or MONTHLY"),
  flag("group-by", "groupBy", "list", "Group rows by dimension (e.g. countryOrRegion)"),
];

const SELECTOR_QUERY = ["selector", "field", "op", "values", "order-by", "fields", "limit", "offset", "all"];
const LIST_QUERY = ["fields", "limit", "offset", "all"];

const op = (
  group: string,
  action: string,
  effect: Exclude<ToolEffect, false>,
  method: AsaMethod,
  path: string,
  summary: string,
  doc: string,
  rest: Partial<AsaOperation> = {},
): AsaOperation => ({ group, action, method, path, summary, doc, ...rest, effect });

const list = (group: string, path: string, summary: string, doc: string, rest: Partial<AsaOperation> = {}) => {
  return op(group, "list", "read", "GET", path, summary, doc, { paged: "query", query: LIST_QUERY, ...rest });
};

const byId = (group: string, path: string, summary: string, doc: string, rest: Partial<AsaOperation> = {}) => {
  return op(group, "get", "read", "GET", path, summary, doc, { positional: "id", query: ["fields"], ...rest });
};

const find = (group: string, path: string, summary: string, doc: string, rest: Partial<AsaOperation> = {}) => {
  return op(group, "find", "read", "POST", path, summary, doc, {
    body: "selector",
    paged: "selector",
    query: SELECTOR_QUERY,
    ...rest,
  });
};

export const ASA_OPERATIONS: AsaOperation[] = [
  list("campaigns", "/campaigns", "List campaigns", "get-all-campaigns"),
  byId("campaigns", "/campaigns/{id}", "Get a campaign", "get-a-campaign"),
  find("campaigns", "/campaigns/find", "Find campaigns with a selector", "find-campaigns"),
  op("campaigns", "create", "destructive", "POST", "/campaigns", "Create a campaign", "create-a-campaign", {
    details: "Creates a campaign with a budget and caller-selected status. ENABLED permits advertising once Apple’s serving requirements are met; this is not restricted to paused drafts.",
    body: "object",
    flags: CAMPAIGN_FIELDS,
  }),
  op("campaigns", "update", "destructive", "PUT", "/campaigns/{id}", "Update a campaign", "update-a-campaign", {
    details: "Overwrites campaign status, countries and daily/lifetime budgets; can enable spending or pause delivery.",
    positional: "id",
    body: "object",
    envelope: "campaign",
    flags: CAMPAIGN_FIELDS,
  }),
  op("campaigns", "delete", "destructive", "DELETE", "/campaigns/{id}", "Delete a campaign", "delete-a-campaign", {
    positional: "id",
  }),

  list("adgroups", "/campaigns/{campaign}/adgroups", "List ad groups in a campaign", "get-all-ad-groups"),
  byId("adgroups", "/campaigns/{campaign}/adgroups/{id}", "Get an ad group", "get-an-ad-group"),
  find("adgroups", "/campaigns/{campaign}/adgroups/find", "Find ad groups in a campaign", "find-ad-groups"),
  find("adgroups", "/adgroups/find", "Find ad groups across the org", "find-ad-groups-(org-level)"),
  op("adgroups", "create", "destructive", "POST", "/campaigns/{campaign}/adgroups", "Create an ad group", "create-an-ad-group", {
    details: "Creates a bid-bearing ad group. An enabled group in an eligible live campaign can begin serving and spending immediately.",
    body: "object",
    flags: ADGROUP_FIELDS,
  }),
  op("adgroups", "update", "destructive", "PUT", "/campaigns/{campaign}/adgroups/{id}", "Update an ad group", "update-an-ad-group", {
    details: "Overwrites ad-group status, bids, CPA goal, dates and Search Match behavior.",
    positional: "id",
    body: "object",
    flags: ADGROUP_FIELDS,
  }),
  op("adgroups", "delete", "destructive", "DELETE", "/campaigns/{campaign}/adgroups/{id}", "Delete an ad group", "delete-an-ad-group", {
    positional: "id",
  }),

  list(
    "keywords",
    "/campaigns/{campaign}/adgroups/{adgroup}/targetingkeywords",
    "List targeting keywords in an ad group",
    "get-all-targeting-keywords-in-an-ad-group",
  ),
  byId(
    "keywords",
    "/campaigns/{campaign}/adgroups/{adgroup}/targetingkeywords/{id}",
    "Get a targeting keyword",
    "get-a-targeting-keyword-in-an-ad-group",
  ),
  find(
    "keywords",
    "/campaigns/{campaign}/adgroups/targetingkeywords/find",
    "Find targeting keywords across a campaign",
    "find-targeting-keywords-in-a-campaign",
  ),
  op(
    "keywords",
    "create",
    "destructive",
    "POST",
    "/campaigns/{campaign}/adgroups/{adgroup}/targetingkeywords/bulk",
    "Create targeting keywords (bulk)",
    "create-targeting-keywords",
    { details: "Creates targeting keywords, which can be ACTIVE with bids in a live ad group and enable spending.", body: "array", flags: KEYWORD_FIELDS },
  ),
  op(
    "keywords",
    "update",
    "destructive",
    "PUT",
    "/campaigns/{campaign}/adgroups/{adgroup}/targetingkeywords/bulk",
    "Update targeting keywords (bulk)",
    "update-targeting-keywords",
    { details: "Bulk-overwrites targeting keyword status, match type or bids.", positional: "id", body: "array", flags: KEYWORD_FIELDS },
  ),
  op(
    "keywords",
    "delete",
    "destructive",
    "DELETE",
    "/campaigns/{campaign}/adgroups/{adgroup}/targetingkeywords/{id}",
    "Delete a targeting keyword",
    "delete-a-targeting-keyword",
    { positional: "ids" },
  ),
  op(
    "keywords",
    "delete",
    "destructive",
    "POST",
    "/campaigns/{campaign}/adgroups/{adgroup}/targetingkeywords/delete/bulk",
    "Delete targeting keywords (bulk)",
    "delete-targeting-keywords",
    { positional: "ids", body: "ids" },
  ),

  list(
    "negative-keywords",
    "/campaigns/{campaign}/negativekeywords",
    "List campaign negative keywords",
    "get-all-campaign-negative-keywords",
  ),
  list(
    "negative-keywords",
    "/campaigns/{campaign}/adgroups/{adgroup}/negativekeywords",
    "List ad group negative keywords",
    "get-all-ad-group-negative-keywords",
  ),
  byId(
    "negative-keywords",
    "/campaigns/{campaign}/negativekeywords/{id}",
    "Get a campaign negative keyword",
    "get-a-campaign-negative-keyword",
  ),
  byId(
    "negative-keywords",
    "/campaigns/{campaign}/adgroups/{adgroup}/negativekeywords/{id}",
    "Get an ad group negative keyword",
    "get-an-ad-group-negative-keyword",
  ),
  find(
    "negative-keywords",
    "/campaigns/{campaign}/negativekeywords/find",
    "Find campaign negative keywords",
    "find-campaign-negative-keywords",
  ),
  find(
    "negative-keywords",
    "/campaigns/{campaign}/adgroups/negativekeywords/find",
    "Find ad group negative keywords across a campaign",
    "find-ad-group-negative-keywords",
    { level: "adgroup" },
  ),
  op(
    "negative-keywords",
    "create",
    "write",
    "POST",
    "/campaigns/{campaign}/negativekeywords/bulk",
    "Create campaign negative keywords (bulk)",
    "create-campaign-negative-keywords",
    { body: "array", flags: NEGATIVE_FIELDS },
  ),
  op(
    "negative-keywords",
    "create",
    "write",
    "POST",
    "/campaigns/{campaign}/adgroups/{adgroup}/negativekeywords/bulk",
    "Create ad group negative keywords (bulk)",
    "create-ad-group-negative-keywords",
    { body: "array", flags: NEGATIVE_FIELDS },
  ),
  op(
    "negative-keywords",
    "update",
    "destructive",
    "PUT",
    "/campaigns/{campaign}/negativekeywords/bulk",
    "Update campaign negative keywords (bulk)",
    "update-campaign-negative-keywords",
    { details: "Bulk-overwrites negative keyword configuration and can change which traffic is excluded.", positional: "id", body: "array", flags: NEGATIVE_FIELDS },
  ),
  op(
    "negative-keywords",
    "update",
    "destructive",
    "PUT",
    "/campaigns/{campaign}/adgroups/{adgroup}/negativekeywords/bulk",
    "Update ad group negative keywords (bulk)",
    "update-ad-group-negative-keywords",
    { details: "Bulk-overwrites negative keyword configuration and can change which traffic is excluded.", positional: "id", body: "array", flags: NEGATIVE_FIELDS },
  ),
  op(
    "negative-keywords",
    "delete",
    "destructive",
    "POST",
    "/campaigns/{campaign}/negativekeywords/delete/bulk",
    "Delete campaign negative keywords",
    "delete-campaign-negative-keywords",
    { positional: "ids", body: "ids" },
  ),
  op(
    "negative-keywords",
    "delete",
    "destructive",
    "POST",
    "/campaigns/{campaign}/adgroups/{adgroup}/negativekeywords/delete/bulk",
    "Delete ad group negative keywords",
    "delete-ad-group-negative-keywords",
    { positional: "ids", body: "ids" },
  ),

  list("ads", "/campaigns/{campaign}/adgroups/{adgroup}/ads", "List ads in an ad group", "get-all-ads"),
  byId("ads", "/campaigns/{campaign}/adgroups/{adgroup}/ads/{id}", "Get an ad", "get-an-ad"),
  find("ads", "/campaigns/{campaign}/ads/find", "Find ads in a campaign", "find-ads"),
  find("ads", "/ads/find", "Find ads across the org", "find-ads-(org-level)"),
  op("ads", "create", "destructive", "POST", "/campaigns/{campaign}/adgroups/{adgroup}/ads", "Create an ad", "create-an-ad", {
    details: "Creates an ad assigned to a creative. An ENABLED ad in an eligible live group can begin serving and spending immediately.",
    body: "object",
    flags: AD_FIELDS,
  }),
  op("ads", "update", "destructive", "PUT", "/campaigns/{campaign}/adgroups/{adgroup}/ads/{id}", "Update an ad", "update-an-ad", {
    details: "Overwrites ad status/name; pausing or enabling changes delivery.",
    positional: "id",
    body: "object",
    flags: [NAME, STATUS],
  }),
  op("ads", "delete", "destructive", "DELETE", "/campaigns/{campaign}/adgroups/{adgroup}/ads/{id}", "Delete an ad", "delete-an-ad", {
    positional: "id",
  }),

  list("creatives", "/creatives", "List creatives", "get-all-creatives"),
  byId("creatives", "/creatives/{id}", "Get a creative", "get-a-creative", {
    query: ["fields", "include-deleted-assets"],
  }),
  find("creatives", "/creatives/find", "Find creatives with a selector", "find-creatives"),
  op("creatives", "create", "write", "POST", "/creatives", "Create a creative", "create-a-creative", {
    body: "object",
    flags: [
      ADAM_ID,
      NAME,
      flag("type", "type", "string", "CUSTOM_PRODUCT_PAGE or DEFAULT_PRODUCT_PAGE"),
      flag("product-page-id", "productPageId", "string", "Custom product page id"),
    ],
  }),

  list("product-pages", "/apps/{adamId}/product-pages", "List an app's custom product pages", "get-product-pages", {
    paged: undefined,
    query: ["adam-id", "name", "states"],
  }),
  byId("product-pages", "/apps/{adamId}/product-pages/{id}", "Get a product page", "get-product-pages-by-identifier", {
    query: ["adam-id"],
  }),
  op(
    "product-pages",
    "locales",
    "read",
    "GET",
    "/apps/{adamId}/product-pages/{id}/locale-details",
    "Get a product page's locales",
    "get-product-page-locales",
    { positional: "id", query: ["adam-id", "device-classes", "language-codes", "expand"] },
  ),
  op(
    "product-pages",
    "countries",
    "read",
    "GET",
    "/countries-or-regions",
    "List supported countries or regions",
    "get-supported-countries-or-regions",
    { query: ["countries"] },
  ),
  op(
    "product-pages",
    "device-sizes",
    "read",
    "GET",
    "/creativeappmappings/devices",
    "List app preview device sizes",
    "get-app-preview-device-sizes",
  ),

  find("ad-rejections", "/product-page-reasons/find", "Find ad creative rejection reasons", "find-ad-creative-rejection-reasons"),
  byId("ad-rejections", "/product-page-reasons/{id}", "Get an ad creative rejection reason", "gets-a-product-page-reason"),
  find("ad-rejections", "/apps/{adamId}/assets/find", "Find an app's assets", "find-app-assets", {
    action: "assets",
    details: "Retrieves asset metadata with a selector using POST; does not modify assets or start a job.",
    query: [...SELECTOR_QUERY, "adam-id"],
  }),

  op("reports", "campaigns", "read", "POST", "/reports/campaigns", "Campaign-level report", "get-campaign-level-reports", {
    body: "report",
    flags: REPORT_FLAGS,
  }),
  op("reports", "adgroups", "read", "POST", "/reports/campaigns/{campaign}/adgroups", "Ad group-level report", "get-ad-group-level-reports", {
    body: "report",
    flags: REPORT_FLAGS,
  }),
  op("reports", "keywords", "read", "POST", "/reports/campaigns/{campaign}/keywords", "Keyword-level report", "get-keyword-level-reports", {
    body: "report",
    flags: REPORT_FLAGS,
  }),
  op(
    "reports",
    "keywords",
    "read",
    "POST",
    "/reports/campaigns/{campaign}/adgroups/{adgroup}/keywords",
    "Keyword-level report within an ad group",
    "get-keyword-level-within-ad-group-reports",
    { body: "report", flags: REPORT_FLAGS },
  ),
  op(
    "reports",
    "searchterms",
    "read",
    "POST",
    "/reports/campaigns/{campaign}/searchterms",
    "Search term-level report",
    "get-search-term-level-reports",
    { body: "report", flags: REPORT_FLAGS },
  ),
  op(
    "reports",
    "searchterms",
    "read",
    "POST",
    "/reports/campaigns/{campaign}/adgroups/{adgroup}/searchterms",
    "Search term-level report within an ad group",
    "get-search-term-level-within-ad-group-reports",
    { body: "report", flags: REPORT_FLAGS },
  ),
  op("reports", "ads", "read", "POST", "/reports/campaigns/{campaign}/ads", "Ad-level report", "get-ad-level-reports", {
    body: "report",
    flags: REPORT_FLAGS,
  }),

  list("impression-share", "/custom-reports", "List impression share reports", "get-all-impression-share-reports"),
  byId("impression-share", "/custom-reports/{id}", "Get an impression share report", "get-a-single-impression-share-report"),
  op("impression-share", "create", "write", "POST", "/custom-reports", "Request an impression share report", "impression-share-report", {
    body: "object",
    flags: [
      NAME,
      START,
      END,
      flag("granularity", "granularity", "string", "DAILY, WEEKLY, or MONTHLY"),
      flag("dimensions", "dimensions", "list", "Comma-separated dimensions (appName, adamId, countryOrRegion, searchTerm)"),
      flag("metrics", "metrics", "list", "Comma-separated metrics"),
    ],
  }),

  op("apps", "search", "read", "GET", "/search/apps", "Search the App Store for apps", "search-for-ios-apps", {
    positional: "query",
    paged: "query",
    query: ["owned", "limit", "offset", "all"],
  }),
  find("apps", "/apps/{adamId}/eligibilities/find", "Find an app's eligibility records", "find-app-eligibility-records", {
    action: "eligibility",
    details: "Retrieves app eligibility records using POST; does not change eligibility or start a job.",
    positional: "adam-id",
  }),
  op("apps", "get", "read", "GET", "/apps/{adamId}", "Get app details", "get-app-details", { positional: "adam-id" }),
  op("apps", "localized", "read", "GET", "/apps/{adamId}/locale-details", "Get localized app details", "get-localized-app-details", {
    positional: "adam-id",
  }),

  op("geo", "search", "read", "GET", "/search/geo", "Search geolocations", "search-for-geolocations", {
    positional: "query",
    paged: "query",
    query: ["country", "entity", "limit", "offset", "all"],
  }),
  op("geo", "get", "read", "POST", "/search/geo", "Look up geolocations by id", "get-a-list-of-geo-locations", {
    details: "Retrieves geolocations by ID using POST; does not create locations or start a job.",
    positional: "ids",
    body: "geo",
    query: ["entity"],
  }),

  list("budget-orders", "/budgetorders", "List budget orders", "get-all-budget-orders"),
  byId("budget-orders", "/budgetorders/{id}", "Get a budget order", "get-a-budget-order"),
  op("budget-orders", "create", "destructive", "POST", "/budgetorders", "Create a budget order", "create-a-budget-order", {
    details: "Creates a financial budget order for the organization. Apple can return it ACTIVE; the request is not restricted to a draft allocation.",
    body: "object",
  }),
  op("budget-orders", "update", "destructive", "PUT", "/budgetorders/{id}", "Update a budget order", "update-a-budget-order", {
    details: "Overwrites a financial budget order using an unrestricted request body.",
    positional: "id",
    body: "object",
  }),

  op("acls", "list", "read", "GET", "/acls", "List the orgs this API user can access", "get-user-acl"),
  op("me", "get", "read", "GET", "/me", "Show the calling API user", "get-me-details"),
];

const PLACEHOLDERS = ["campaign", "adgroup", "adamId", "id"] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

export function placeholdersOf(path: string): Placeholder[] {
  return PLACEHOLDERS.filter((p) => path.includes(`{${p}}`));
}

export function asaGroups(): string[] {
  return [...new Set(ASA_OPERATIONS.map((o) => o.group))];
}

export function asaActions(group: string): string[] {
  return [...new Set(ASA_OPERATIONS.filter((o) => o.group === group).map((o) => o.action))];
}

export function asaVariants(group: string, action: string): AsaOperation[] {
  return ASA_OPERATIONS.filter((o) => o.group === group && o.action === action);
}

export interface AsaScope {
  campaign?: string;
  adgroup?: string;
  adamId?: string;
  ids: string[];
  adgroupLevel?: boolean;
}

export function selectVariant(variants: AsaOperation[], scope: AsaScope): AsaOperation {
  const have = (p: Placeholder): boolean => {
    return p === "id" ? scope.ids.length === 1 : Boolean(scope[p]);
  };
  const leveled = variants.some((v) => v.level === "adgroup");
  const candidates = variants
    .filter((v) => !leveled || (v.level === "adgroup") === Boolean(scope.adgroupLevel))
    .filter((v) => placeholdersOf(v.path).every(have))
    .sort((a, b) => placeholdersOf(b.path).length - placeholdersOf(a.path).length);
  const pick = candidates[0];
  if (pick) return pick;
  const [simplest] = [...variants].sort(
    (a, b) => placeholdersOf(a.path).length - placeholdersOf(b.path).length,
  );
  if (!simplest) throw new Error("No Apple Search Ads operation to choose from.");
  const missing = placeholdersOf(simplest.path)
    .filter((p) => !have(p))
    .map((p) => {
      if (p === "id") return "exactly one id";
      if (p === "adamId") return "--adam-id <id>";
      return `--${p} <id>`;
    });
  throw new Error(`asa ${simplest.group} ${simplest.action} needs ${missing.join(" and ")}.`);
}

export function fillPath(path: string, scope: AsaScope): string {
  return path
    .replace("{campaign}", encodeURIComponent(scope.campaign ?? ""))
    .replace("{adgroup}", encodeURIComponent(scope.adgroup ?? ""))
    .replace("{adamId}", encodeURIComponent(scope.adamId ?? ""))
    .replace("{id}", encodeURIComponent(scope.ids[0] ?? ""));
}

export function appleDocUrl(op: AsaOperation): string {
  return `${APPLE_DOCS_BASE}/${op.doc}`;
}
