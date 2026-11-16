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
  assert.match(root, /\n {2}campaigns +list · get · create · update · delete · limited-reasons\n/);
  assert.match(root, /\n {2}docs \[resource \[operation\] \| words\] +Every endpoint, with Apple's own schema\n/);
  assert.match(root, /Run superwall asa <command> --help for its flags\.\n$/);
  assert.doesNotMatch(root, /\nCommon\n/);
  assert.doesNotMatch(root, / find /);
  assert.equal(page("nonsense"), root);
});

test("a resource page lists its operations with their arguments, hiding long usages", () => {
  const apps = page("apps");
  assert.match(apps, /^superwall asa apps <operation>\nApple Search Ads apps\n\nOperations\n/);
  assert.match(apps, /\n {2}search <query> +Search the App Store for apps\n/);
  assert.match(apps, /\n {2}get <adam-id> +Get app details\n/);
  assert.match(apps, /Run superwall asa apps <operation> --help for its flags\.\n$/);
  const keywords = page("keywords");
  assert.match(keywords, /\n {2}delete <id\[,id…\]> +Delete a targeting keyword\n/);
  assert.match(keywords, /\n {2}list +List targeting keywords\n/);
  assert.equal(page("apps", "nonsense"), apps);
});

test("an operation page shows its typed flags, body options and the common flags", () => {
  const create = page("adgroups", "create");
  assert.match(create, /^superwall asa adgroups create\nCreate an ad group\n/);
  assert.match(create, /\n {2}--name <value> +Name\n/);
  assert.match(create, /\n {2}--campaign <n> +Campaign id\n/);
  assert.match(create, /\n {2}--bid <amount> +Default bid\n/);
  assert.match(create, /\n {2}--search-match +Enable Search Match\n/);
  assert.match(create, /\n {2}-d key=value +Another body field/);
  assert.match(create, /\n {2}--body <json\|@file\|@-> +The whole request body\n/);
  assert.match(create, /\nCommon\n {2}--json +Machine-readable output\n {2}--no-interactive +No prompts/);
  assert.match(create, /\nDetails\n {2}Creates a bid-bearing ad group\./);
  assert.match(create, /\n {2}Apple's schema for it: superwall asa docs adgroups create\n$/);
  assert.match(page("campaigns", "create"), /\n {2}--countries <a,b,c> +Comma-separated country or region codes\n {2}--daily-budget <amount>/);
  assert.match(page("campaigns", "create"), /\n {2}--adam-id <value> +App Store app id \(adamId\) to promote\n/);
  assert.match(page("keywords", "create"), /--body <json\|@file\|@-> +The whole request body; an array goes to the bulk endpoint\n/);
  const del = page("keywords", "delete");
  assert.match(del, /\n {2}--body <json\|@file\|@-> +Bulk items instead of ids/);
  assert.doesNotMatch(del, /-d key=value/);
});

test("operation usages name ids, queries, App Store ids and the filters they take", () => {
  assert.match(page("ads", "update"), /^superwall asa ads update <id>\n/);
  assert.match(page("keywords", "delete"), /^superwall asa keywords delete <id\[,id…\]>\n/);
  assert.match(page("keywords", "delete"), /\nDelete a targeting keyword; Delete targeting keywords \(bulk\)\n/);
  assert.match(page("keywords", "list"), /^superwall asa keywords list \[--campaign <id>\] \[--adgroup <id>\]\n/);
  assert.match(page("reports", "adgroups"), /^superwall asa reports adgroups --campaign <id> \[--adgroup <id>\]\n/);
  assert.match(page("geo", "search"), /^superwall asa geo search <query>\n/);
  assert.match(page("apps", "get"), /^superwall asa apps get <adam-id>\n/);
  assert.match(page("apps", "eligibility"), /^superwall asa apps eligibility <adam-id>\n/);
  assert.match(page("product-pages", "list"), /^superwall asa product-pages list --adam-id <id>\n/);
  assert.match(page("product-pages", "locales"), /^superwall asa product-pages locales <id>\n/);
  assert.match(page("me", "get"), /^superwall asa me get\nShow the calling API user\n/);
});

test("query, report, geo and paging options appear only where they apply", () => {
  const list = page("campaigns", "list");
  assert.match(list, /--query <json\|@file\|@-> +An Apple query request/);
  assert.match(list, /--field --op --values +One filter/);
  assert.match(list, /--order-by <field\[:asc\|desc\]> +Sort/);
  assert.match(list, /--limit <n> --offset <n> --all +Paging/);
  assert.doesNotMatch(list, /--time-zone|--start|--fields/);

  const report = page("reports", "adgroups");
  assert.match(report, /--start --end <YYYY-MM-DD> +Report range/);
  assert.match(report, /--group-by <a,b> +Group rows by dimension\n {2}--fields <a,b> +Only these fields\n {2}--time-zone <UTC\|ORTZ>/);
  assert.match(report, /--limit <n> --offset <n> --all/);
  assert.doesNotMatch(page("insights", "impression-share"), /--time-zone/);

  assert.match(page("geo", "get"), /--entity <Country\|AdminArea\|Locality>/);
  assert.doesNotMatch(page("campaigns", "get"), /--limit|--query|--body/);
  assert.match(page("recommendations", "apply-target-cpas"), /--body <json\|@file\|@-> +The request body: an array/);
});

test("operation help discloses activation, spending, financial orders and read-only POST queries", () => {
  assert.match(page("campaigns", "create"), /ENABLED permits advertising/);
  assert.match(page("adgroups", "create"), /begin serving and spending/);
  assert.match(page("keywords", "create"), /ENABLED with bids/);
  assert.match(page("ads", "create"), /begin serving and spending/);
  assert.match(page("budget-orders", "create"), /financial budget order/);
  assert.match(page("recommendations", "apply-daily-budgets"), /how much campaigns can spend/);
  assert.match(page("geo", "get"), /does not create locations or start a job/);
  assert.match(page("campaigns", "list"), /Queries with POST; changes nothing\./);
});
