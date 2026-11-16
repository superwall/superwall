import { test } from "node:test";
import assert from "node:assert/strict";
import { command } from "@/commands/apple-search-ads/asa";
import {
  ASA_OPERATIONS,
  appleDocUrl,
  asaActions,
  asaGroups,
  asaVariants,
  fillPath,
  filterValue,
  placeholdersOf,
  selectVariant,
} from "@/core/apple-search-ads/catalog";

test("every operation names a group, action, Platform API doc slug, and a versionless path", () => {
  for (const op of ASA_OPERATIONS) {
    assert.ok(op.group && op.action && op.doc, `${op.group} ${op.action}`);
    assert.ok(op.path.startsWith("/"), op.path);
    assert.ok(!op.path.startsWith("/api/") && !op.path.startsWith("/v1"), op.path);
    assert.equal(op.doc, op.doc.toLowerCase(), op.doc);
    assert.match(appleDocUrl(op), /^https:\/\/developer\.apple\.com\/documentation\/apple-ads-platform-api\//);
  }
});

test("no operation reaches a v5 path: lists are queries and resources sit at the top level", () => {
  for (const op of ASA_OPERATIONS) {
    assert.doesNotMatch(op.path, /\/find$|targetingkeywords|negativekeywords|budgetorders|custom-reports|\{campaign\}|\{adgroup\}/, op.path);
    if (op.body === "query" || op.body === "report") {
      assert.equal(op.method, "POST", op.path);
      assert.match(op.path, /\/query$/, op.path);
    }
  }
});

test("variants of one action agree on their positional", () => {
  for (const group of asaGroups()) {
    for (const action of asaActions(group)) {
      const positionals = new Set(asaVariants(group, action).map((v) => v.positional));
      assert.equal(positionals.size, 1, `${group} ${action}`);
    }
  }
});

test("every flag an operation reads is a flag of the asa command", () => {
  const declared = Object.keys(command.flags ?? {});
  const camel = (name: string) => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  for (const op of ASA_OPERATIONS) {
    const names = [
      ...(op.flags ?? []).map((f) => f.flag),
      ...(op.filters ?? []).map((f) => f.flag).filter((f) => f !== "id"),
      ...(op.query ?? []),
    ];
    for (const name of names) assert.ok(declared.includes(camel(name)), `${op.group} ${op.action}: --${name}`);
  }
});

test("placeholdersOf reads the ids a path needs", () => {
  assert.deepEqual(placeholdersOf("/campaigns/{id}"), ["id"]);
  assert.deepEqual(placeholdersOf("/apps/{adamId}/locale-details/query"), ["adamId"]);
  assert.deepEqual(placeholdersOf("/keywords/query"), []);
});

test("selectVariant picks the single endpoint for one id and the bulk one for several or a bulk body", () => {
  const del = asaVariants("keywords", "delete");
  assert.equal(selectVariant(del, { ids: ["9"] }).method, "DELETE");
  assert.equal(selectVariant(del, { ids: ["9", "10"] }).path, "/keywords/bulk-delete");
  const create = asaVariants("keywords", "create");
  assert.equal(selectVariant(create, { ids: [] }).path, "/keywords");
  assert.equal(selectVariant(create, { ids: [], bulk: true }).path, "/keywords/bulk-create");
  const update = asaVariants("negative-keywords", "update");
  assert.equal(selectVariant(update, { ids: ["1"] }).method, "PUT");
  assert.equal(selectVariant(update, { ids: ["1", "2"] }).path, "/negative-keywords/bulk-update");
});

test("selectVariant explains what is missing: an id, the app, or a required filter", () => {
  assert.throws(() => selectVariant(asaVariants("campaigns", "get"), { ids: ["1", "2"] }), {
    message: "asa campaigns get needs exactly one id.",
  });
  assert.throws(() => selectVariant(asaVariants("reports", "keywords"), { ids: [] }), {
    message: "asa reports keywords needs --campaign <id>.",
  });
  assert.doesNotThrow(() => selectVariant(asaVariants("reports", "campaigns"), { ids: [] }));
  assert.throws(() => selectVariant(asaVariants("product-pages", "list"), { ids: [] }), {
    message: "asa product-pages list needs --adam-id <id>.",
  });
  assert.throws(() => selectVariant(asaVariants("product-pages", "locales"), { ids: [] }), {
    message: "asa product-pages locales needs an id.",
  });
  assert.throws(() => selectVariant(asaVariants("apps", "localized"), { ids: [] }), {
    message: "asa apps localized needs --adam-id <id>.",
  });
  assert.throws(() => selectVariant([], { ids: [] }), { message: "No Apple Search Ads operation to choose from." });
});

test("filterValue reads each scope a filter names", () => {
  const scope = { campaign: "1", adgroup: "2", adamId: "3", ids: ["4"] };
  assert.equal(filterValue({ flag: "campaign", field: "campaignId" }, scope), "1");
  assert.equal(filterValue({ flag: "adgroup", field: "adGroupId" }, scope), "2");
  assert.equal(filterValue({ flag: "adam-id", field: "adamId" }, scope), "3");
  assert.equal(filterValue({ flag: "id", field: "productPageId" }, scope), "4");
});

test("fillPath substitutes and encodes ids", () => {
  assert.equal(fillPath("/campaigns/{id}", { ids: ["4 5"] }), "/campaigns/4%205");
  assert.equal(fillPath("/apps/{adamId}/locale-details/query", { adamId: "42", ids: [] }), "/apps/42/locale-details/query");
});

test("the catalog covers the whole Apple Ads Platform API v1 surface reachable as JSON", () => {
  const expected: [string, string, string, string][] = [
    ["campaigns", "list", "POST", "/campaigns/query"],
    ["campaigns", "get", "GET", "/campaigns/{id}"],
    ["campaigns", "create", "POST", "/campaigns"],
    ["campaigns", "update", "PUT", "/campaigns/{id}"],
    ["campaigns", "delete", "DELETE", "/campaigns/{id}"],
    ["campaigns", "limited-reasons", "GET", "/campaigns/{id}/legacy-app-limited-status-reason-details"],
    ["adgroups", "list", "POST", "/adgroups/query"],
    ["adgroups", "get", "GET", "/adgroups/{id}"],
    ["adgroups", "create", "POST", "/adgroups"],
    ["adgroups", "update", "PUT", "/adgroups/{id}"],
    ["adgroups", "delete", "DELETE", "/adgroups/{id}"],
    ["keywords", "list", "POST", "/keywords/query"],
    ["keywords", "get", "GET", "/keywords/{id}"],
    ["keywords", "create", "POST", "/keywords"],
    ["keywords", "create", "POST", "/keywords/bulk-create"],
    ["keywords", "update", "PUT", "/keywords/{id}"],
    ["keywords", "update", "POST", "/keywords/bulk-update"],
    ["keywords", "delete", "DELETE", "/keywords/{id}"],
    ["keywords", "delete", "POST", "/keywords/bulk-delete"],
    ["negative-keywords", "list", "POST", "/negative-keywords/query"],
    ["negative-keywords", "get", "GET", "/negative-keywords/{id}"],
    ["negative-keywords", "create", "POST", "/negative-keywords"],
    ["negative-keywords", "create", "POST", "/negative-keywords/bulk-create"],
    ["negative-keywords", "update", "PUT", "/negative-keywords/{id}"],
    ["negative-keywords", "update", "POST", "/negative-keywords/bulk-update"],
    ["negative-keywords", "delete", "DELETE", "/negative-keywords/{id}"],
    ["negative-keywords", "delete", "POST", "/negative-keywords/bulk-delete"],
    ["ads", "list", "POST", "/ads/query"],
    ["ads", "get", "GET", "/ads/{id}"],
    ["ads", "create", "POST", "/ads"],
    ["ads", "update", "PUT", "/ads/{id}"],
    ["ads", "delete", "DELETE", "/ads/{id}"],
    ["creatives", "list", "POST", "/creatives/query"],
    ["creatives", "get", "GET", "/creatives/{id}"],
    ["creatives", "create", "POST", "/creatives"],
    ["creatives", "update", "PUT", "/creatives/{id}"],
    ["creatives", "delete", "DELETE", "/creatives/{id}"],
    ["assets", "list", "POST", "/assets/query"],
    ["assets", "get", "GET", "/assets/{id}"],
    ["assets", "delete", "DELETE", "/assets/{id}"],
    ["product-pages", "list", "POST", "/product-pages/query"],
    ["product-pages", "get", "GET", "/product-pages/{id}"],
    ["product-pages", "locales", "POST", "/product-pages/locale-details/query"],
    ["ad-rejections", "list", "POST", "/rejection-reasons/apps/query"],
    ["ad-rejections", "get", "GET", "/rejection-reasons/apps/{id}"],
    ["reports", "campaigns", "POST", "/reports/apps/campaigns/query"],
    ["reports", "adgroups", "POST", "/reports/apps/adgroups/query"],
    ["reports", "keywords", "POST", "/reports/apps/keywords/query"],
    ["reports", "searchterms", "POST", "/reports/apps/searchterms/query"],
    ["reports", "ads", "POST", "/reports/apps/ads/query"],
    ["brand-reports", "campaigns", "POST", "/reports/business-brands/campaigns/query"],
    ["brand-reports", "adgroups", "POST", "/reports/business-brands/adgroups/query"],
    ["brand-reports", "keywords", "POST", "/reports/business-brands/keywords/query"],
    ["brand-reports", "searchterms", "POST", "/reports/business-brands/searchterms/query"],
    ["brand-reports", "ads", "POST", "/reports/business-brands/ads/query"],
    ["insights", "impression-share", "POST", "/insights/apps/impression-share/query"],
    ["insights", "search-term-popularity", "POST", "/insights/apps/search-term-popularity/query"],
    ["apps", "search", "GET", "/search/apps"],
    ["apps", "eligibility", "POST", "/eligibilities/apps/query"],
    ["apps", "get", "GET", "/apps/{adamId}"],
    ["apps", "localized", "POST", "/apps/{adamId}/locale-details/query"],
    ["apps", "languages", "POST", "/metadata/apps/supported-languages/query"],
    ["geo", "search", "GET", "/search/geo"],
    ["geo", "get", "POST", "/search/geo"],
    ["budget-orders", "list", "POST", "/shared-budgets/query"],
    ["budget-orders", "get", "GET", "/shared-budgets/{id}"],
    ["budget-orders", "create", "POST", "/shared-budgets"],
    ["budget-orders", "update", "PUT", "/shared-budgets/{id}"],
    ["budget-orders", "delete", "DELETE", "/shared-budgets/{id}"],
    ["recommendations", "target-cpas", "POST", "/recommendations/target-cpas/query"],
    ["recommendations", "apply-target-cpas", "POST", "/recommendations/target-cpas/apply"],
    ["recommendations", "dismiss-target-cpas", "POST", "/recommendations/target-cpas/dismiss"],
    ["recommendations", "daily-budgets", "POST", "/recommendations/daily-budgets/query"],
    ["recommendations", "apply-daily-budgets", "POST", "/recommendations/daily-budgets/apply"],
    ["recommendations", "dismiss-daily-budgets", "POST", "/recommendations/daily-budgets/dismiss"],
    ["suggestions", "keywords", "POST", "/suggestions/keywords/query"],
    ["suggestions", "phrases", "POST", "/suggestions/phrases/query"],
    ["suggestions", "categories", "POST", "/suggestions/categories/query"],
    ["suggestions", "target-cpa", "POST", "/suggestions/target-cpas/query"],
    ["change-history", "list", "POST", "/change-history/query"],
    ["change-history", "get", "GET", "/change-history/{id}"],
    ["brands", "list", "POST", "/business-brands/query"],
    ["brands", "get", "GET", "/business-brands/{id}"],
    ["brands", "categories", "POST", "/business-categories/query"],
    ["brands", "category", "GET", "/business-categories/{id}"],
    ["brands", "rejections", "POST", "/rejection-reasons/business-brands/query"],
    ["ad-accounts", "get", "GET", "/ad-accounts/{id}"],
    ["ad-accounts", "create", "POST", "/ad-accounts"],
    ["ad-accounts", "update", "PUT", "/ad-accounts/{id}"],
    ["ad-accounts", "resources", "GET", "/advertiser-resources"],
    ["orgs", "get", "GET", "/orgs/{id}"],
    ["acls", "list", "GET", "/acls"],
    ["me", "get", "GET", "/me"],
  ];
  for (const [group, action, method, path] of expected) {
    assert.ok(
      asaVariants(group, action).some((v) => v.method === method && v.path === path),
      `${group} ${action}: ${method} ${path}`,
    );
  }
  assert.equal(ASA_OPERATIONS.length, expected.length);
});

test("effects follow what each endpoint does, not its HTTP verb", () => {
  const effectOf = (group: string, action: string) => new Set(asaVariants(group, action).map((v) => v.effect));
  for (const [group, action] of [
    ["campaigns", "list"],
    ["reports", "keywords"],
    ["insights", "impression-share"],
    ["apps", "eligibility"],
    ["geo", "get"],
    ["suggestions", "keywords"],
    ["recommendations", "target-cpas"],
    ["change-history", "list"],
  ] as const) {
    assert.deepEqual([...effectOf(group, action)], ["read"], `${group} ${action}`);
  }
  for (const [group, action] of [
    ["campaigns", "create"],
    ["campaigns", "update"],
    ["keywords", "create"],
    ["keywords", "delete"],
    ["budget-orders", "create"],
    ["recommendations", "apply-target-cpas"],
    ["recommendations", "apply-daily-budgets"],
    ["ad-accounts", "update"],
    ["assets", "delete"],
  ] as const) {
    assert.deepEqual([...effectOf(group, action)], ["destructive"], `${group} ${action}`);
  }
  for (const [group, action] of [
    ["negative-keywords", "create"],
    ["creatives", "create"],
    ["recommendations", "dismiss-target-cpas"],
    ["ad-accounts", "create"],
  ] as const) {
    assert.deepEqual([...effectOf(group, action)], ["write"], `${group} ${action}`);
  }
});
