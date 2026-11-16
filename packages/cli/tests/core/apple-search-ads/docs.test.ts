import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPLE_DOC_DATA_BASE,
  renderAppleDoc,
  renderAsaCatalog,
  renderAsaGroup,
  renderAsaOperationDocs,
  renderAsaSearch,
  searchAsaCatalog,
} from "@/core/apple-search-ads/docs";
import { restoreFetch, useFetch } from "../../helpers/fetch";

afterEach(() => restoreFetch());

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures", name), "utf8"));

test("renderAsaCatalog lists every group with usage and paths", () => {
  const md = renderAsaCatalog();
  assert.match(md, /## campaigns/);
  assert.match(md, /Every Apple Ads Platform API v1 endpoint/);
  assert.match(md, /`superwall asa campaigns get <id>` — Get a campaign  \(GET \/campaigns\/\{id\}\)/);
  assert.match(md, /`superwall asa keywords delete <id\[,id\.\.\.\]>` — Delete a targeting keyword  \(DELETE \/keywords\/\{id\} \| POST \/keywords\/bulk-delete\)/);
  assert.match(md, /`superwall asa keywords list \[--campaign <id>\] \[--adgroup <id>\]` — List targeting keywords  \(POST \/keywords\/query\)/);
  assert.match(md, /superwall asa me/);
  assert.match(md, /superwall asa acls/);
  assert.match(md, /Raw: `superwall asa get\|post\|put\|delete/);
});

test("renderAsaGroup shows each variant with its flags", () => {
  const md = renderAsaGroup("campaigns");
  assert.match(md, /## superwall asa campaigns create/);
  assert.match(md, /--daily-budget <amount>  Daily budget → `dailyBudget.value`/);
  assert.match(md, /--body <json\|@file\|@->/);
  assert.match(md, /https:\/\/developer\.apple\.com\/documentation\/apple-ads-platform-api\/post-campaigns/);
  assert.match(md, /--query <json\|@file\|@->  Full Apple query request/);
  const keywords = renderAsaGroup("keywords");
  assert.match(keywords, /## superwall asa keywords create\nCreate targeting keywords \(bulk\)\n`POST \/keywords\/bulk-create`/);
  assert.match(keywords, /--body <json\|@file\|@->  Full request body \(bulk: an array of items\)/);
  const geo = renderAsaGroup("geo");
  assert.match(geo, /--entity <Country\|AdminArea\|Locality>  Entity type for each id\n  --supply-source <APPSTORE\|MAPS>/);
  const reports = renderAsaGroup("reports");
  assert.match(reports, /--start <YYYY-MM-DD> --end <YYYY-MM-DD>  Report range/);
  assert.match(reports, /--time-zone/);
  assert.doesNotMatch(renderAsaGroup("insights"), /--time-zone/);
  assert.match(renderAsaGroup("recommendations"), /--body <json\|@file\|@->  The request body: an array/);
});

test("search finds operations by summary, path, or name", () => {
  assert.ok(searchAsaCatalog("negative-keywords").length >= 8);
  assert.match(renderAsaSearch("impression"), /impression-share/);
  assert.match(renderAsaSearch("zzz"), /No Apple Search Ads endpoint matches/);
});

test("renderAppleDoc turns Apple's page JSON into markdown", () => {
  const md = renderAppleDoc(fixture("asa-doc-query-campaigns.json"));
  assert.match(md, /^# Query Campaigns\nQuery campaigns using filters, sorting, and pagination\./);
  assert.match(md, /`POST https:\/\/api\.ads\.apple\.com\/v1\/campaigns\/query`/);
  assert.match(md, /## Header Parameters\n- `X-AP-Context` \(required\) — string/);
  assert.match(md, /## HTTP Body\n`QueryRequest`/);
  assert.match(md, /- 200 OK `CampaignQueryResponse`/);
  assert.match(md, /- 400 Bad Request `ErrorResponse`/);
  assert.match(md, /`status` \| string \(enum\) \| `EQUALS`, `IN` \| Yes \|/);
  const object = renderAppleDoc(fixture("asa-doc-campaign.json"));
  assert.match(object, /^# Campaign\n/);
  assert.match(object, /## Properties/);
  assert.match(object, /- `adAccountId` — int64: The ad account this campaign belongs to\. Read-only\./);
  assert.match(object, /- `status` — Campaign\.Status: Captures the advertiser’s intent/);
  assert.equal(renderAppleDoc(null), "");
  assert.equal(renderAppleDoc({ primaryContentSections: [{ kind: "unknown" }, "x"] }), "");
});

test("renderAsaOperationDocs stitches the usage, Apple's page, and the body object", async () => {
  const fetched: string[] = [];
  const md = await renderAsaOperationDocs("campaigns", "list", async (url) => {
    fetched.push(url);
    if (url.endsWith("/post-campaigns-query.json")) return fixture("asa-doc-query-campaigns.json");
    if (url.endsWith("/queryrequest.json")) return { metadata: { title: "QueryRequest" } };
    throw new Error("unexpected");
  });
  assert.deepEqual(fetched, [`${APPLE_DOC_DATA_BASE}/post-campaigns-query.json`, `${APPLE_DOC_DATA_BASE}/queryrequest.json`]);
  assert.match(md, /## superwall asa campaigns list/);
  assert.match(md, /# Query Campaigns/);
  assert.match(md, /`POST \/campaigns\/query`\n\n {2}--query <json\|@file\|@->/);
  assert.match(md, /\n# QueryRequest$/);
});

test("renderAsaOperationDocs follows the request body type and reports fetch failures", async () => {
  const withBody = {
    metadata: { title: "Create a Campaign" },
    primaryContentSections: [
      { kind: "restEndpoint", tokens: [{ text: "POST " }, { text: "https://api.ads.apple.com/v1/campaigns" }] },
      {
        kind: "restBody",
        title: "HTTP Body",
        bodyContentType: [{ kind: "typeIdentifier", identifier: "doc://com.apple.apple-ads-platform-api/documentation/Apple-Ads-Platform-API/CampaignCreate", text: "CampaignCreate" }],
        content: [{ type: "paragraph", inlineContent: [{ type: "text", text: "The campaign." }] }],
        parameters: [],
      },
    ],
    references: {},
  };
  const md = await renderAsaOperationDocs("campaigns", "create", async (url) => {
    if (url.endsWith("/post-campaigns.json")) return withBody;
    if (url.endsWith("/campaigncreate.json")) return fixture("asa-doc-campaign.json");
    throw new Error("unexpected");
  });
  assert.match(md, /## HTTP Body\n`CampaignCreate` — The campaign\./);
  assert.match(md, /## Properties/);

  const failing = await renderAsaOperationDocs("campaigns", "create", async (url) => {
    if (url.endsWith("/post-campaigns.json")) return withBody;
    throw new Error("offline");
  });
  assert.match(failing, /Couldn't fetch the `CampaignCreate` object page \(offline\) — see https:\/\/developer\.apple\.com\/documentation\/apple-ads-platform-api\/campaigncreate/);

  const allFailing = await renderAsaOperationDocs("campaigns", "create", async () => {
    throw new Error("HTTP 503");
  });
  assert.match(allFailing, /Couldn't fetch Apple's page \(HTTP 503\) — read it at https:\/\/developer\.apple\.com/);

  await assert.rejects(renderAsaOperationDocs("campaigns", "nope"), /Unknown "asa campaigns nope"/);
});

test("renderAppleDoc handles lists, tables, code, and inline references", () => {
  const md = renderAppleDoc({
    metadata: { title: "T" },
    abstract: [{ type: "text", text: "Abstract " }, { type: "reference", identifier: "r1" }],
    primaryContentSections: [
      {
        kind: "content",
        content: [
          { type: "heading", text: "Discussion" },
          {
            type: "unorderedList",
            items: [{ content: [{ type: "paragraph", inlineContent: [{ type: "codeVoice", code: "adamId" }, { type: "strong", inlineContent: [{ type: "text", text: "!" }] }, { type: "unknown" }] }] }],
          },
          { type: "table", rows: [[[{ type: "paragraph", inlineContent: [{ type: "text", text: "a" }] }], [{ type: "paragraph", inlineContent: [{ type: "text", text: "b" }] }]]] },
          { type: "codeListing", code: ["{", "}"] },
          {
            type: "tabNavigator",
            tabs: [{ title: "Request", content: [{ type: "codeListing", code: ["POST /x", "[1]"] }] }, "junk"],
          },
          { type: "aside" },
        ],
      },
      { kind: "restParameters", title: "Path Parameters", items: [{ name: "id", required: true, type: [{ text: "int64" }], attributes: [{ kind: "minimum", value: "1" }, { kind: "maximum", value: "9" }, { kind: "other" }] }] },
      { kind: "restResponses", items: [{ status: 400, reason: "Bad Request", type: [], content: [] }, "junk"] },
      { kind: "restBody", title: "HTTP Body", bodyContentType: [], content: [], parameters: [{ name: "x", type: [{ text: "string" }] }] },
    ],
    references: { r1: { title: "Ref" } },
  });
  assert.match(md, /^# T\nAbstract Ref/);
  assert.match(md, /### Discussion/);
  assert.match(md, /- `adamId`!/);
  assert.match(md, /a \| b/);
  assert.match(md, /```\n\{\n\}\n```/);
  assert.match(md, /\*\*Request\*\*\n```\nPOST \/x\n\[1\]\n```/);
  assert.match(md, /- `id` \(required\) — int64, min 1, max 9/);
  assert.match(md, /- 400 Bad Request/);
  assert.match(md, /## HTTP Body\n- `x` — string/);
});

test("renderAsaOperationDocs downloads Apple's page itself when no fetcher is given", async () => {
  const log = useFetch([{ match: "/get-current-user-details.json", body: { metadata: { title: "Get Me Details" } } }]);
  const md = await renderAsaOperationDocs("me", "get");
  assert.deepEqual(log.map((entry) => entry.url), [`${APPLE_DOC_DATA_BASE}/get-current-user-details.json`]);
  assert.match(md, /^## superwall asa me\nShow the calling API user\n`GET \/me`\n\nApple: .*apple-ads-platform-api\/get-current-user-details\n\n# Get Me Details$/);

  useFetch([]);
  assert.match(await renderAsaOperationDocs("acls", "list"), /Couldn't fetch Apple's page \(HTTP 404\)/);
});

test("renderAsaOperationDocs reports a fetch failure that isn't an Error", async () => {
  const md = await renderAsaOperationDocs("me", "get", async () => {
    throw "rate limited";
  });
  assert.match(md, /Couldn't fetch Apple's page \(rate limited\)/);
});

test("renderAppleDoc renders content sections, bounds, and skips what it can't read", () => {
  const md = renderAppleDoc({
    metadata: { title: "Budget" },
    abstract: [{ type: "strong", inlineContent: [{ type: "text", text: "Money" }] }, { type: "image" }, 3],
    primaryContentSections: [
      { kind: "content", content: [{ type: "heading", text: "Overview" }, { type: "paragraph", inlineContent: [{ type: "text", text: "Spend." }] }] },
      {
        kind: "restParameters",
        title: "Path Parameters",
        items: [
          "skip",
          {
            name: "amount",
            type: [{ text: "int64" }, "x"],
            attributes: [{ kind: "minimum", value: "1" }, { kind: "maximum", value: "9" }, { kind: "other" }, "y"],
          },
          { name: "note" },
        ],
      },
      { kind: "restParameters", title: "Empty", items: [] },
      { kind: "restBody", content: [], parameters: [] },
      { kind: "restResponses", items: ["skip", { status: 204, reason: "No Content" }] },
      { kind: "restResponses", items: [] },
      { kind: "properties", items: [] },
    ],
  });
  assert.equal(
    md,
    [
      "# Budget",
      "Money",
      "",
      "### Overview",
      "Spend.",
      "",
      "## Path Parameters",
      "- `amount` — int64, min 1, max 9",
      "- `note`",
      "",
      "## HTTP Body",
      "",
      "## Responses",
      "- 204 No Content",
    ].join("\n"),
  );
});

test("renderAsaGroup lists each operation's URL params, filters, typed flags and their body keys", () => {
  const apps = renderAsaGroup("apps");
  assert.match(apps, /## superwall asa apps search <query>\n.*\n.*\n\n {2}--limit <n> --offset <n> --all {2}Paging \(--all walks every page\)\n {2}--owned {2}Only apps this account owns\n {2}--store-fronts <a,b>/);
  assert.match(apps, /## superwall asa apps get <adam-id>\n/);
  assert.match(apps, /## superwall asa apps eligibility <adam-id>\n/);
  const geo = renderAsaGroup("geo");
  assert.match(geo, / {2}--country <CC> {2}Restrict to a country code\n {2}--entity <Country\|AdminArea\|Locality>\n {2}--supply-source <APPSTORE\|MAPS>/);
  assert.match(geo, / {2}--eligible {2}Only places that can be targeted/);
  assert.match(renderAsaGroup("ad-accounts"), / {2}--resource-type <type> {2}e\.g\. CONTENT_PROVIDER/);
  assert.match(renderAsaGroup("product-pages"), /## superwall asa product-pages list --adam-id <id>\n/);
  assert.match(renderAsaGroup("reports"), /## superwall asa reports keywords --campaign <id> \[--adgroup <id>\]\n/);
  const campaigns = renderAsaGroup("campaigns");
  assert.match(campaigns, / {2}--adam-id <value> {2}App Store app id \(adamId\) to promote → `promotedObjectId`/);
  assert.match(campaigns, / {2}--countries <a,b,c> {2}Comma-separated country or region codes → `targeting.countryOrRegion.include`/);
  assert.match(renderAsaGroup("adgroups"), / {2}--search-match {2}Enable Search Match → `automatedKeywordsOptIn`/);
  assert.match(renderAsaGroup("keywords"), / {2}--adgroup <n> {2}Ad group id → `adGroupId`/);
});

test("renderAppleDoc skips nodes it can't read inside text and lists", () => {
  const md = renderAppleDoc({
    abstract: [{ type: "text", text: "A" }, { type: "image" }, { type: "reference", identifier: "missing" }],
    primaryContentSections: [
      {
        kind: "content",
        content: ["raw", { type: "unorderedList", items: ["raw", { content: [{ type: "paragraph", inlineContent: [{ type: "text", text: "item" }] }] }] }],
      },
    ],
  });
  assert.equal(md, "A\n\n- item");
});

test("renderAsaOperationDocs fetches no object page when the body names no type", async () => {
  const fetched: string[] = [];
  await renderAsaOperationDocs("campaigns", "create", async (url) => {
    fetched.push(url);
    return {
      primaryContentSections: [
        "raw",
        { kind: "restBody", bodyContentType: [{ kind: "text", text: "JSON" }, "raw", { kind: "typeIdentifier", identifier: "" }] },
      ],
    };
  });
  assert.deepEqual(fetched, [`${APPLE_DOC_DATA_BASE}/post-campaigns.json`]);
});
