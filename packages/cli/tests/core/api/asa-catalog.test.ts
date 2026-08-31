import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASA_OPERATIONS,
  appleDocUrl,
  asaActions,
  asaGroups,
  asaVariants,
  fillPath,
  placeholdersOf,
  selectVariant,
} from "@/core/api/asa-catalog";

test("every operation names a group, action, Apple doc slug, and a versionless path", () => {
  for (const op of ASA_OPERATIONS) {
    assert.ok(op.group && op.action && op.doc, `${op.group} ${op.action}`);
    assert.ok(op.path.startsWith("/"), op.path);
    assert.ok(!op.path.startsWith("/api/"), op.path);
    assert.match(appleDocUrl(op), /^https:\/\/developer\.apple\.com\/documentation\/apple_ads\//);
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

test("placeholdersOf reads the scope a path needs", () => {
  assert.deepEqual(placeholdersOf("/campaigns/{campaign}/adgroups/{adgroup}/ads/{id}"), [
    "campaign",
    "adgroup",
    "id",
  ]);
  assert.deepEqual(placeholdersOf("/apps/{adamId}/product-pages"), ["adamId"]);
});

test("selectVariant prefers the most specific satisfied variant", () => {
  const find = asaVariants("adgroups", "find");
  assert.equal(selectVariant(find, { ids: [] }).path, "/adgroups/find");
  assert.equal(selectVariant(find, { ids: [], campaign: "1" }).path, "/campaigns/{campaign}/adgroups/find");
});

test("selectVariant picks single delete for one id and bulk for several", () => {
  const del = asaVariants("keywords", "delete");
  const scope = { campaign: "1", adgroup: "2" };
  assert.equal(selectVariant(del, { ...scope, ids: ["9"] }).method, "DELETE");
  assert.equal(selectVariant(del, { ...scope, ids: ["9", "10"] }).path.endsWith("/delete/bulk"), true);
});

test("selectVariant honours --adgroup-level on negative keyword find", () => {
  const find = asaVariants("negative-keywords", "find");
  assert.equal(
    selectVariant(find, { ids: [], campaign: "1" }).path,
    "/campaigns/{campaign}/negativekeywords/find",
  );
  assert.equal(
    selectVariant(find, { ids: [], campaign: "1", adgroupLevel: true }).path,
    "/campaigns/{campaign}/adgroups/negativekeywords/find",
  );
});

test("selectVariant explains what scope is missing", () => {
  assert.throws(
    () => selectVariant(asaVariants("keywords", "list"), { ids: [] }),
    /needs --campaign <id> and --adgroup <id>/,
  );
  assert.throws(
    () => selectVariant(asaVariants("campaigns", "get"), { ids: ["1", "2"] }),
    /exactly one id/,
  );
});

test("fillPath substitutes and encodes scope values", () => {
  assert.equal(
    fillPath("/campaigns/{campaign}/adgroups/{adgroup}/ads/{id}", {
      campaign: "1",
      adgroup: "2 3",
      ids: ["4"],
    }),
    "/campaigns/1/adgroups/2%203/ads/4",
  );
  assert.equal(fillPath("/apps/{adamId}", { adamId: "42", ids: [] }), "/apps/42");
});

test("the catalog covers the whole Apple Ads v5 surface", () => {
  const expected = [
    ["campaigns", "list"], ["campaigns", "get"], ["campaigns", "find"], ["campaigns", "create"], ["campaigns", "update"], ["campaigns", "delete"],
    ["adgroups", "list"], ["adgroups", "get"], ["adgroups", "find"], ["adgroups", "create"], ["adgroups", "update"], ["adgroups", "delete"],
    ["keywords", "list"], ["keywords", "get"], ["keywords", "find"], ["keywords", "create"], ["keywords", "update"], ["keywords", "delete"],
    ["negative-keywords", "list"], ["negative-keywords", "get"], ["negative-keywords", "find"], ["negative-keywords", "create"], ["negative-keywords", "update"], ["negative-keywords", "delete"],
    ["ads", "list"], ["ads", "get"], ["ads", "find"], ["ads", "create"], ["ads", "update"], ["ads", "delete"],
    ["creatives", "list"], ["creatives", "get"], ["creatives", "find"], ["creatives", "create"],
    ["product-pages", "list"], ["product-pages", "get"], ["product-pages", "locales"], ["product-pages", "countries"], ["product-pages", "device-sizes"],
    ["ad-rejections", "find"], ["ad-rejections", "get"], ["ad-rejections", "assets"],
    ["reports", "campaigns"], ["reports", "adgroups"], ["reports", "keywords"], ["reports", "searchterms"], ["reports", "ads"],
    ["impression-share", "list"], ["impression-share", "get"], ["impression-share", "create"],
    ["apps", "search"], ["apps", "eligibility"], ["apps", "get"], ["apps", "localized"],
    ["geo", "search"], ["geo", "get"],
    ["budget-orders", "list"], ["budget-orders", "get"], ["budget-orders", "create"], ["budget-orders", "update"],
    ["acls", "list"], ["me", "get"],
  ];
  for (const [group, action] of expected) {
    assert.ok(asaVariants(group!, action!).length > 0, `${group} ${action}`);
  }
  assert.equal(ASA_OPERATIONS.length, 73);
});
