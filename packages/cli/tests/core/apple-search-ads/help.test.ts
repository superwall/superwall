import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { renderAsaHelp } from "@/core/apple-search-ads/help";

const page = (...words: string[]) => stripVTControlCharacters(renderAsaHelp(words));

test("the root page lists resources, keys, raw requests and the reference, also for an unknown resource", () => {
  const root = page();
  assert.match(root, /^superwall asa <resource> <operation>\nThe Apple Search Ads API through Superwall's proxy/);
  for (const title of ["Resources", "Keys", "Any request", "Reference", "Examples"]) {
    assert.match(root, new RegExp(`\\n${title}\\n`));
  }
  assert.match(root, /\n {2}campaigns +list · get · find · create · update · delete\n/);
  assert.match(root, /\n {2}docs \[resource \[operation\] \| words\] +Every endpoint, with Apple's own schema\n/);
  assert.match(root, /Run superwall asa <command> --help for its flags\.\n$/);
  assert.doesNotMatch(root, /\nCommon\n/);
  assert.equal(page("nonsense"), root);
});

test("a resource page lists its operations with their arguments, hiding long usages", () => {
  const apps = page("apps");
  assert.match(apps, /^superwall asa apps <operation>\nApple Search Ads apps\n\nOperations\n/);
  assert.match(apps, /\n {2}search <query> +Search the App Store for apps\n/);
  assert.match(apps, /\n {2}get <adam-id> +Get app details\n/);
  assert.match(apps, /Run superwall asa apps <operation> --help for its flags\.\n$/);
  const keywords = page("keywords");
  assert.match(keywords, /\n {2}delete +Delete a targeting keyword\n/);
  assert.equal(page("apps", "nonsense"), apps);
});

test("an operation page shows its arguments, typed flags, body options and the common flags", () => {
  const create = page("adgroups", "create");
  assert.match(create, /^superwall asa adgroups create --campaign <id>\nCreate an ad group\n/);
  assert.match(create, /\n {2}--name <value> +Name\n/);
  assert.match(create, /\n {2}--default-bid <amount> +Default CPT bid\n/);
  assert.match(create, /\n {2}--search-match +Enable Search Match\n/);
  assert.match(create, /\n {2}-d key=value +Another body field/);
  assert.match(create, /\n {2}--body <json\|@file\|@-> +The whole request body\n/);
  assert.match(create, /\nCommon\n {2}--json +Machine-readable output\n {2}--no-interactive +No prompts/);
  assert.match(create, /\nDetails\n {2}Creates a bid-bearing ad group\./);
  assert.match(create, /\n {2}Apple's schema for it: superwall asa docs adgroups create\n$/);
  assert.match(page("campaigns", "create"), /\n {2}--countries <a,b,c> +Comma-separated country codes\n {2}--budget <amount>/);
  assert.match(page("campaigns", "create"), /\n {2}--adam-id <n> +App Store app id/);
});

test("operation usages name ids, queries, App Store ids and the scopes in their path", () => {
  assert.match(page("ads", "update"), /^superwall asa ads update <id> --campaign <id> --adgroup <id>\n/);
  assert.match(page("keywords", "delete"), /^superwall asa keywords delete <id\[,id…\]> --campaign <id> --adgroup <id>\n/);
  assert.match(page("keywords", "delete"), /\nDelete a targeting keyword; Delete targeting keywords \(bulk\)\n/);
  assert.match(page("geo", "search"), /^superwall asa geo search <query>\n/);
  assert.match(page("apps", "get"), /^superwall asa apps get <adam-id>\n/);
  assert.match(page("product-pages", "list"), /^superwall asa product-pages list --adam-id <id>\n/);
  assert.match(page("me", "get"), /^superwall asa me get\nShow the calling API user\n/);
});

test("selector, report, paging and field options appear only where they apply", () => {
  const find = page("campaigns", "find");
  assert.match(find, /--selector <json\|@file\|@->/);
  assert.match(find, /--field --op --values +One condition/);
  assert.match(find, /--order-by <field\[:asc\|desc\]> +Sort/);
  assert.match(find, /--fields <a,b> +Only these fields/);
  assert.match(find, /--limit <n> --offset <n> --all +Paging/);
  assert.doesNotMatch(find, /--time-zone/);

  const report = page("reports", "adgroups");
  assert.match(report, /--selector <json\|@file\|@-> +An Apple selector\n {2}--time-zone <UTC\|ORTZ>/);
  assert.doesNotMatch(report, /--order-by|--fields|--limit/);

  assert.match(page("campaigns", "get"), /--fields <a,b>/);
  assert.doesNotMatch(page("campaigns", "get"), /--limit/);
  assert.match(page("negative-keywords", "find"), /\n {2}--adgroup-level +Ad group negatives instead of the campaign's\n/);
  assert.doesNotMatch(page("campaigns", "find"), /--adgroup-level/);
});

test("operation help discloses activation, spending, financial orders and read-only POST lookups", () => {
  assert.match(page("campaigns", "create"), /ENABLED permits advertising/);
  assert.match(page("adgroups", "create"), /begin serving and spending/);
  assert.match(page("keywords", "create"), /ACTIVE with bids/);
  assert.match(page("ads", "create"), /begin serving and spending/);
  assert.match(page("budget-orders", "create"), /financial budget order/);
  assert.match(page("geo", "get"), /does not create locations or start a job/);
});
