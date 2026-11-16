import type { ToolEffect } from "@/program/command";

type AsaMethod = "GET" | "POST" | "PUT" | "DELETE";

type AsaBody = "object" | "query" | "report" | "bulk" | "array" | "geo";

type AsaFlagType = "string" | "number" | "boolean" | "money" | "list";

export interface AsaFlag {
  flag: string;
  key: string;
  type: AsaFlagType;
  describe: string;
}

export interface AsaFilter {
  flag: "campaign" | "adgroup" | "adam-id" | "id";
  field: string;
  required?: boolean;
  text?: boolean;
  list?: boolean;
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
  flags?: AsaFlag[];
  defaults?: Record<string, unknown>;
  account?: "adAccountId" | "adAccountIds";
  filters?: AsaFilter[];
  query?: string[];
  pageSize?: string;
  paged?: boolean;
  zoned?: boolean;
}

export const APPLE_DOCS_BASE = "https://developer.apple.com/documentation/apple-ads-platform-api";

const flag = (flag: string, key: string, type: AsaFlagType, describe: string): AsaFlag => ({
  flag,
  key,
  type,
  describe,
});

const NAME = flag("name", "name", "string", "Name");
const STATUS = flag("status", "status", "string", "ENABLED or PAUSED");
const START = flag("start", "startTime", "string", "Start (yyyy-MM-ddTHH:mm:ss.SSS, UTC)");
const END = flag("end", "endTime", "string", "End (yyyy-MM-ddTHH:mm:ss.SSS, UTC)");
const BID_STRATEGY = flag("bid-strategy", "bidStrategy.bidStrategyType", "string", "MANUAL_CPT, MAX_CONVERSIONS, ... (with --bid-goal)");
const BID_GOAL = flag("bid-goal", "bidStrategy.bidStrategyGoal", "string", "TAP, INSTALL, ... (with --bid-strategy)");
const MATCH_TYPE = flag("match-type", "matchType", "string", "EXACT, BROAD, PHRASE or CATEGORY");
const TEXT = flag("text", "text", "string", "Keyword text");
const BID = flag("bid", "bid", "money", "Keyword bid");
const IN_CAMPAIGN = flag("campaign", "campaignId", "number", "Campaign id");
const IN_ADGROUP = flag("adgroup", "adGroupId", "number", "Ad group id");

const CAMPAIGN_UPDATE: AsaFlag[] = [
  NAME,
  flag("countries", "targeting.countryOrRegion.include", "list", "Comma-separated country or region codes"),
  flag("daily-budget", "dailyBudget.value", "money", "Daily budget"),
  flag("supply-sources", "targeting.supplySource.include", "list", "Comma-separated supply sources (APPSTORE, MAPS)"),
  flag("supply-placements", "targeting.supplyPlacement.include", "list", "Comma-separated placements (APPSTORE_SEARCH_RESULTS, APPSTORE_TODAY_TAB, ...)"),
  BID_STRATEGY,
  BID_GOAL,
  START,
  END,
  STATUS,
];

const ADGROUP_UPDATE: AsaFlag[] = [
  NAME,
  flag("bid", "bidStrategy.bid", "money", "Default bid"),
  BID_STRATEGY,
  BID_GOAL,
  flag("search-match", "automatedKeywordsOptIn", "boolean", "Enable Search Match"),
  START,
  END,
  STATUS,
];

const KEYWORD_CREATE: AsaFlag[] = [IN_ADGROUP, TEXT, MATCH_TYPE, BID, STATUS];
const KEYWORD_UPDATE: AsaFlag[] = [BID, STATUS];
const NEGATIVE_CREATE: AsaFlag[] = [IN_CAMPAIGN, IN_ADGROUP, TEXT, MATCH_TYPE, STATUS];

const BUDGET_UPDATE: AsaFlag[] = [NAME, START, END, flag("amount", "value", "money", "Total budget")];

const CAMPAIGN_SCOPE: AsaFilter = { flag: "campaign", field: "campaignId" };
const ADGROUP_SCOPE: AsaFilter = { flag: "adgroup", field: "adGroupId" };

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

const query = (group: string, path: string, summary: string, doc: string, rest: Partial<AsaOperation> = {}) => {
  return op(group, "list", "read", "POST", path, summary, doc, {
    body: "query",
    paged: true,
    details: "Queries with POST; changes nothing.",
    ...rest,
  });
};

const byId = (group: string, path: string, summary: string, doc: string, rest: Partial<AsaOperation> = {}) => {
  return op(group, "get", "read", "GET", path, summary, doc, { positional: "id", ...rest });
};

const remove = (group: string, path: string, summary: string, doc: string, rest: Partial<AsaOperation> = {}) => {
  return op(group, "delete", "destructive", "DELETE", path, summary, doc, { positional: "id", ...rest });
};

const appReport = (action: string, path: string, summary: string, doc: string, scoped: boolean) => {
  return op("reports", action, "read", "POST", `/reports/apps/${path}/query`, summary, doc, {
    body: "report",
    paged: true,
    zoned: true,
    filters: [{ ...CAMPAIGN_SCOPE, text: true, required: scoped }, { ...ADGROUP_SCOPE, text: true }],
  });
};

const brandReport = (action: string, path: string, summary: string, doc: string, scoped: boolean) => {
  return op("brand-reports", action, "read", "POST", `/reports/business-brands/${path}/query`, summary, doc, {
    body: "report",
    paged: true,
    zoned: true,
    filters: [{ ...CAMPAIGN_SCOPE, text: true, required: scoped }, { ...ADGROUP_SCOPE, text: true }],
  });
};

const PROMOTED_APP: AsaFilter = { flag: "adam-id", field: "promotedObjectId", text: true, list: true };

export const ASA_OPERATIONS: AsaOperation[] = [
  query("campaigns", "/campaigns/query", "List campaigns", "post-campaigns-query"),
  byId("campaigns", "/campaigns/{id}", "Get a campaign", "get-campaigns-_id_"),
  op("campaigns", "create", "destructive", "POST", "/campaigns", "Create a campaign", "post-campaigns", {
    details: "Creates a campaign with a daily budget and caller-selected status. ENABLED permits advertising once Apple’s serving requirements are met; this is not restricted to paused drafts.",
    body: "object",
    flags: [
      NAME,
      flag("adam-id", "promotedObjectId", "string", "App Store app id (adamId) to promote"),
      flag("promoted-type", "promotedObjectType", "string", "APPSTORE_APP (default) or BUSINESS_BRAND"),
      flag("billing-event", "billingEvent", "string", "TAPS or IMPRESSIONS"),
      ...CAMPAIGN_UPDATE.slice(1),
    ],
    defaults: { promotedObjectType: "APPSTORE_APP" },
    account: "adAccountId",
  }),
  op("campaigns", "update", "destructive", "PUT", "/campaigns/{id}", "Update a campaign", "put-campaigns-_id_", {
    details: "Overwrites campaign status, targeting, bid strategy and daily budget; can enable spending or pause delivery.",
    positional: "id",
    body: "object",
    flags: CAMPAIGN_UPDATE,
  }),
  remove("campaigns", "/campaigns/{id}", "Delete a campaign", "delete-campaigns-_id_"),
  op(
    "campaigns",
    "limited-reasons",
    "read",
    "GET",
    "/campaigns/{id}/legacy-app-limited-status-reason-details",
    "Why a legacy app campaign is limited",
    "get-campaigns-_id_-legacy-app-limited-status-reason-details",
    { positional: "id" },
  ),

  query("adgroups", "/adgroups/query", "List ad groups", "post-adgroups-query", { filters: [CAMPAIGN_SCOPE] }),
  byId("adgroups", "/adgroups/{id}", "Get an ad group", "get-adgroups-_id_"),
  op("adgroups", "create", "destructive", "POST", "/adgroups", "Create an ad group", "post-adgroups", {
    details: "Creates a bid-bearing ad group. An enabled group in an eligible live campaign can begin serving and spending immediately.",
    body: "object",
    flags: [
      NAME,
      IN_CAMPAIGN,
      flag("pricing-model", "pricingModel", "string", "CPT, CPM or CPA (must match the campaign's billing event)"),
      ...ADGROUP_UPDATE.slice(1),
    ],
  }),
  op("adgroups", "update", "destructive", "PUT", "/adgroups/{id}", "Update an ad group", "put-adgroups-_id_", {
    details: "Overwrites ad-group status, bids, bid strategy, dates and Search Match behavior.",
    positional: "id",
    body: "object",
    flags: ADGROUP_UPDATE,
  }),
  remove("adgroups", "/adgroups/{id}", "Delete an ad group", "delete-adgroups-_id_"),

  query("keywords", "/keywords/query", "List targeting keywords", "post-keywords-query", {
    filters: [CAMPAIGN_SCOPE, ADGROUP_SCOPE],
  }),
  byId("keywords", "/keywords/{id}", "Get a targeting keyword", "get-keywords-_id_"),
  op("keywords", "create", "destructive", "POST", "/keywords", "Create a targeting keyword", "post-keywords", {
    details: "Creates targeting keywords, which can be ENABLED with bids in a live ad group and enable spending.",
    body: "object",
    flags: KEYWORD_CREATE,
  }),
  op("keywords", "create", "destructive", "POST", "/keywords/bulk-create", "Create targeting keywords (bulk)", "post-keywords-bulk-create", {
    body: "bulk",
    flags: KEYWORD_CREATE,
  }),
  op("keywords", "update", "destructive", "PUT", "/keywords/{id}", "Update a targeting keyword", "put-keywords-_id_", {
    details: "Overwrites targeting keyword status or bids.",
    positional: "ids",
    body: "object",
    flags: KEYWORD_UPDATE,
  }),
  op("keywords", "update", "destructive", "POST", "/keywords/bulk-update", "Update targeting keywords (bulk)", "post-keywords-bulk-update", {
    positional: "ids",
    body: "bulk",
    flags: KEYWORD_UPDATE,
  }),
  remove("keywords", "/keywords/{id}", "Delete a targeting keyword", "delete-keywords-_id_", { positional: "ids" }),
  op("keywords", "delete", "destructive", "POST", "/keywords/bulk-delete", "Delete targeting keywords (bulk)", "post-keywords-bulk-delete", {
    positional: "ids",
    body: "bulk",
  }),

  query("negative-keywords", "/negative-keywords/query", "List negative keywords", "post-negative-keywords-query", {
    filters: [CAMPAIGN_SCOPE, ADGROUP_SCOPE],
  }),
  byId("negative-keywords", "/negative-keywords/{id}", "Get a negative keyword", "get-negative-keywords-_id_"),
  op("negative-keywords", "create", "write", "POST", "/negative-keywords", "Create a negative keyword", "post-negative-keywords", {
    details: "Creates a campaign negative keyword, or an ad group one with --adgroup.",
    body: "object",
    flags: NEGATIVE_CREATE,
  }),
  op(
    "negative-keywords",
    "create",
    "write",
    "POST",
    "/negative-keywords/bulk-create",
    "Create negative keywords (bulk)",
    "post-negative-keywords-bulk-create",
    { body: "bulk", flags: NEGATIVE_CREATE },
  ),
  op("negative-keywords", "update", "destructive", "PUT", "/negative-keywords/{id}", "Update a negative keyword", "put-negative-keywords-_id_", {
    details: "Overwrites negative keyword status and can change which traffic is excluded.",
    positional: "ids",
    body: "object",
    flags: [STATUS],
  }),
  op(
    "negative-keywords",
    "update",
    "destructive",
    "POST",
    "/negative-keywords/bulk-update",
    "Update negative keywords (bulk)",
    "post-negative-keywords-bulk-update",
    { positional: "ids", body: "bulk", flags: [STATUS] },
  ),
  remove("negative-keywords", "/negative-keywords/{id}", "Delete a negative keyword", "delete-negative-keywords-_id_", {
    positional: "ids",
  }),
  op(
    "negative-keywords",
    "delete",
    "destructive",
    "POST",
    "/negative-keywords/bulk-delete",
    "Delete negative keywords (bulk)",
    "post-negative-keywords-bulk-delete",
    { positional: "ids", body: "bulk" },
  ),

  query("ads", "/ads/query", "List ads", "post-ads-query", { filters: [CAMPAIGN_SCOPE, ADGROUP_SCOPE] }),
  byId("ads", "/ads/{id}", "Get an ad", "get-ads-_id_"),
  op("ads", "create", "destructive", "POST", "/ads", "Create an ad", "post-ads", {
    details: "Creates an ad assigned to a creative. An ENABLED ad in an eligible live group can begin serving and spending immediately.",
    body: "object",
    flags: [IN_ADGROUP, flag("creative-id", "creativeId", "number", "Creative id"), NAME, STATUS],
  }),
  op("ads", "update", "destructive", "PUT", "/ads/{id}", "Update an ad", "put-ads-_id_", {
    details: "Overwrites ad status/name; pausing or enabling changes delivery.",
    positional: "id",
    body: "object",
    flags: [NAME, STATUS],
  }),
  remove("ads", "/ads/{id}", "Delete an ad", "delete-ads-_id_"),

  query("creatives", "/creatives/query", "List creatives", "post-creatives-query"),
  byId("creatives", "/creatives/{id}", "Get a creative", "get-creatives-_id_"),
  op("creatives", "create", "write", "POST", "/creatives", "Create a creative", "post-creatives", {
    body: "object",
    flags: [
      NAME,
      flag("type", "creativeType", "string", "CUSTOM_PRODUCT_PAGE, DEFAULT_PRODUCT_PAGE, ..."),
      flag("adam-id", "destination.parameters.adamId", "string", "App Store app id (adamId)"),
      flag("product-page-id", "destination.parameters.productPageId", "string", "Custom product page id"),
    ],
    defaults: { creativeSpec: {}, destination: { destinationType: "APP_STORE_PRODUCT_PAGE" } },
  }),
  op("creatives", "update", "write", "PUT", "/creatives/{id}", "Update a creative", "put-creatives-_id_", {
    details: "Renames a creative or replaces its spec; a new spec sends it back to review.",
    positional: "id",
    body: "object",
    flags: [NAME],
  }),
  remove("creatives", "/creatives/{id}", "Delete a creative", "delete-creatives-_id_"),

  query("assets", "/assets/query", "List assets", "query-assets", { filters: [{ ...PROMOTED_APP, list: false }] }),
  byId("assets", "/assets/{id}", "Get an asset", "get-asset-by-id"),
  remove("assets", "/assets/{id}", "Delete an asset", "delete-asset-by-id"),

  query("product-pages", "/product-pages/query", "List an app's custom product pages", "query-product-pages", {
    filters: [{ flag: "adam-id", field: "adamId", required: true }],
  }),
  byId("product-pages", "/product-pages/{id}", "Get a product page", "get-product-page-by-id"),
  query("product-pages", "/product-pages/locale-details/query", "Get a product page's locales", "query-product-page-locale-details", {
    action: "locales",
    positional: "id",
    filters: [{ flag: "id", field: "productPageId", required: true, text: true }],
  }),

  query("ad-rejections", "/rejection-reasons/apps/query", "List ad creative rejection reasons", "find-rejection-reasons", {
    filters: [{ flag: "adam-id", field: "adamId" }],
  }),
  byId("ad-rejections", "/rejection-reasons/apps/{id}", "Get an ad creative rejection reason", "gets-rejection-reasons-by-id"),

  appReport("campaigns", "campaigns", "Campaign-level report", "get-app-campaign-reports", false),
  appReport("adgroups", "adgroups", "Ad group-level report", "get-app-ad-group-reports", true),
  appReport("keywords", "keywords", "Keyword-level report", "get-app-keyword-reports", true),
  appReport("searchterms", "searchterms", "Search term-level report", "get-app-search-term-reports", true),
  appReport("ads", "ads", "Ad-level report", "get-app-ad-reports", true),

  brandReport("campaigns", "campaigns", "Apple Maps campaign-level report", "get-brand-campaign-reports", false),
  brandReport("adgroups", "adgroups", "Apple Maps ad group-level report", "get-brand-ad-group-reports", true),
  brandReport("keywords", "keywords", "Apple Maps keyword-level report", "get-brand-keyword-reports", true),
  brandReport("searchterms", "searchterms", "Apple Maps search term-level report", "get-brand-search-term-reports", true),
  brandReport("ads", "ads", "Apple Maps ad-level report", "get-brand-ad-reports", true),

  op("insights", "impression-share", "read", "POST", "/insights/apps/impression-share/query", "App impression share", "query-app-impression-share-data", {
    body: "report",
    paged: true,
    filters: [{ ...PROMOTED_APP, list: false }],
  }),
  op(
    "insights",
    "search-term-popularity",
    "read",
    "POST",
    "/insights/apps/search-term-popularity/query",
    "Search term popularity",
    "query-app-search-term-popularity-data",
    { body: "report", paged: true },
  ),

  op("apps", "search", "read", "GET", "/search/apps", "Search the App Store for apps", "searches-for-a-list-of-apps", {
    positional: "query",
    paged: true,
    query: ["owned", "store-fronts", "limit", "offset", "all"],
  }),
  query("apps", "/eligibilities/apps/query", "Check an app's eligibility", "find-apps-eligibilities", {
    action: "eligibility",
    positional: "adam-id",
    filters: [{ flag: "adam-id", field: "adamId", required: true }],
  }),
  op("apps", "get", "read", "GET", "/apps/{adamId}", "Get app details", "get-app-details-by-adam-id", { positional: "adam-id" }),
  query("apps", "/apps/{adamId}/locale-details/query", "Get an app's default product page locales", "query-default-product-page-locale-details-by-adam-id", {
    action: "localized",
    positional: "adam-id",
  }),
  query("apps", "/metadata/apps/supported-languages/query", "List supported app languages", "query-supported-app-languages", {
    action: "languages",
  }),

  op("geo", "search", "read", "GET", "/search/geo", "Search geolocations", "searches-for-a-list-of-geo-locations", {
    positional: "query",
    paged: true,
    pageSize: "pageSize",
    defaults: { supplySource: "APPSTORE" },
    query: ["supply-source", "country", "entity", "eligible", "limit", "offset", "all"],
  }),
  op("geo", "get", "read", "POST", "/search/geo", "Look up geolocations by id", "gets-a-list-of-geo-locations", {
    details: "Retrieves geolocations by ID using POST; does not create locations or start a job.",
    positional: "ids",
    body: "geo",
  }),

  query("budget-orders", "/shared-budgets/query", "List budget orders", "post-shared-budgets-query"),
  byId("budget-orders", "/shared-budgets/{id}", "Get a budget order", "get-shared-budgets-_id_"),
  op("budget-orders", "create", "destructive", "POST", "/shared-budgets", "Create a budget order", "post-shared-budgets", {
    details: "Creates a financial budget order that ad accounts can draw from; it needs invoice details in --body or -d.",
    body: "object",
    flags: BUDGET_UPDATE,
    account: "adAccountIds",
  }),
  op("budget-orders", "update", "destructive", "PUT", "/shared-budgets/{id}", "Update a budget order", "put-shared-budgets-_id_", {
    details: "Overwrites a financial budget order's amount, dates, accounts or invoice details.",
    positional: "id",
    body: "object",
    flags: BUDGET_UPDATE,
  }),
  remove("budget-orders", "/shared-budgets/{id}", "Delete a budget order", "delete-shared-budgets-_id_"),

  query("recommendations", "/recommendations/target-cpas/query", "Target CPA recommendations", "query-target-cpa-recommendations", {
    action: "target-cpas",
    filters: [PROMOTED_APP],
  }),
  op("recommendations", "apply-target-cpas", "destructive", "POST", "/recommendations/target-cpas/apply", "Apply target CPA recommendations", "apply-target-cpa-recommendations", {
    details: "Applies recommended target CPAs, which changes how ad groups bid and spend.",
    body: "array",
  }),
  op("recommendations", "dismiss-target-cpas", "write", "POST", "/recommendations/target-cpas/dismiss", "Dismiss target CPA recommendations", "dismiss-target-cpa-recommendations", {
    body: "array",
  }),
  query("recommendations", "/recommendations/daily-budgets/query", "Daily budget recommendations", "query-daily-budget-recommendations", {
    action: "daily-budgets",
    filters: [PROMOTED_APP],
  }),
  op("recommendations", "apply-daily-budgets", "destructive", "POST", "/recommendations/daily-budgets/apply", "Apply daily budget recommendations", "apply-daily-budget-recommendations", {
    details: "Applies recommended daily budgets, which changes how much campaigns can spend.",
    body: "array",
  }),
  op("recommendations", "dismiss-daily-budgets", "write", "POST", "/recommendations/daily-budgets/dismiss", "Dismiss daily budget recommendations", "dismiss-daily-budget-recommendations", {
    body: "array",
  }),

  query("suggestions", "/suggestions/keywords/query", "Keyword suggestions", "query-keyword-suggestions", { action: "keywords", filters: [PROMOTED_APP] }),
  query("suggestions", "/suggestions/phrases/query", "Phrase suggestions", "query-phrase-suggestions", { action: "phrases", filters: [PROMOTED_APP] }),
  query("suggestions", "/suggestions/categories/query", "Category suggestions", "query-category-suggestions", { action: "categories", filters: [PROMOTED_APP] }),
  query("suggestions", "/suggestions/target-cpas/query", "Target CPA suggestion", "query-target-cpa-suggestion", { action: "target-cpa", filters: [PROMOTED_APP] }),

  query("change-history", "/change-history/query", "List changes", "query-audit-summary-_-grouped-by-transaction"),
  byId("change-history", "/change-history/{id}", "Get a change's details", "get-change-details-by-detailid", {
    paged: true,
    query: ["limit", "offset", "all"],
  }),

  query("brands", "/business-brands/query", "List Apple Maps brands", "query-brands"),
  byId("brands", "/business-brands/{id}", "Get an Apple Maps brand", "get-brand-by-id"),
  query("brands", "/business-categories/query", "List business categories", "query-categories", { action: "categories" }),
  op("brands", "category", "read", "GET", "/business-categories/{id}", "Get a business category", "get-category-by-id", { positional: "id" }),
  query("brands", "/rejection-reasons/business-brands/query", "List brand rejection reasons", "query-policy-assignments-(rejection-reasons)-for-external-consumers", {
    action: "rejections",
  }),

  byId("ad-accounts", "/ad-accounts/{id}", "Get an ad account", "get-ad-accounts-_id_"),
  op("ad-accounts", "create", "write", "POST", "/ad-accounts", "Create ad accounts", "post-ad-accounts", {
    details: "Creates ad accounts with their product features and advertiser delegations.",
    body: "object",
    flags: [NAME],
  }),
  op("ad-accounts", "update", "destructive", "PUT", "/ad-accounts/{id}", "Update an ad account", "put-ad-accounts-_id_", {
    details: "Overwrites an ad account's name, product features or delegations, which can change what it may advertise.",
    positional: "id",
    body: "object",
    flags: [NAME],
  }),
  op("ad-accounts", "resources", "read", "GET", "/advertiser-resources", "List advertiser resources", "get-advertiser-resources", {
    query: ["resource-type"],
  }),

  op("orgs", "get", "read", "GET", "/orgs/{id}", "Get an org", "get-orgs-_id_", { positional: "id" }),
  op("acls", "list", "read", "GET", "/acls", "List the ad accounts this API user can access", "get-user-acls"),
  op("me", "get", "read", "GET", "/me", "Show the calling API user", "get-current-user-details"),
];

const PLACEHOLDERS = ["adamId", "id"] as const;
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
  bulk?: boolean;
}

const filterFlag = (filter: AsaFilter): string => {
  return filter.flag === "id" ? "an id" : `--${filter.flag} <id>`;
};

export function filterValue(filter: AsaFilter, scope: AsaScope): string | undefined {
  if (filter.flag === "campaign") return scope.campaign;
  if (filter.flag === "adgroup") return scope.adgroup;
  if (filter.flag === "adam-id") return scope.adamId;
  return scope.ids[0];
}

export function selectVariant(variants: AsaOperation[], scope: AsaScope): AsaOperation {
  const bulk = scope.bulk === true || scope.ids.length > 1;
  const pick = variants.find((v) => (v.body === "bulk") === bulk) ?? variants[0];
  if (!pick) throw new Error("No Apple Search Ads operation to choose from.");
  const missing = [
    ...placeholdersOf(pick.path)
      .filter((p) => (p === "id" ? scope.ids.length !== 1 : !scope.adamId))
      .map((p) => (p === "id" ? "exactly one id" : "--adam-id <id>")),
    ...(pick.filters ?? []).filter((f) => f.required && !filterValue(f, scope)).map(filterFlag),
  ];
  if (missing.length) throw new Error(`asa ${pick.group} ${pick.action} needs ${missing.join(" and ")}.`);
  return pick;
}

export function fillPath(path: string, scope: AsaScope): string {
  return path
    .replace("{adamId}", encodeURIComponent(scope.adamId ?? ""))
    .replace("{id}", encodeURIComponent(scope.ids[0] ?? ""));
}

export function appleDocUrl(op: AsaOperation): string {
  return `${APPLE_DOCS_BASE}/${op.doc}`;
}
