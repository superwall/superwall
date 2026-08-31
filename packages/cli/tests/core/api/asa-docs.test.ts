import { test } from "node:test";
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
} from "@/core/api/asa-docs";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures", name), "utf8"));

test("renderAsaCatalog lists every group with usage and paths", () => {
  const md = renderAsaCatalog();
  assert.match(md, /## campaigns/);
  assert.match(md, /`superwall asa campaigns get <id>` — Get a campaign  \(GET \/campaigns\/\{id\}\)/);
  assert.match(md, /superwall asa keywords delete <id\[,id\.\.\.\]> --campaign <id> --adgroup <id>/);
  assert.match(md, /superwall asa me/);
  assert.match(md, /superwall asa acls/);
  assert.match(md, /Raw: `superwall asa get\|post\|put\|delete/);
});

test("renderAsaGroup shows each variant with its flags", () => {
  const md = renderAsaGroup("campaigns");
  assert.match(md, /## superwall asa campaigns create/);
  assert.match(md, /--daily-budget <amount>  Daily budget → `dailyBudgetAmount`/);
  assert.match(md, /--body <json\|@file\|@->/);
  assert.match(md, /https:\/\/developer\.apple\.com\/documentation\/apple_ads\/create-a-campaign/);
  const negatives = renderAsaGroup("negative-keywords");
  assert.match(negatives, /--adgroup-level/);
  const geo = renderAsaGroup("geo");
  assert.match(geo, /--entity <Country\|AdminArea\|Locality>/);
  const reports = renderAsaGroup("reports");
  assert.match(reports, /--time-zone/);
});

test("search finds operations by summary, path, or name", () => {
  assert.ok(searchAsaCatalog("negativekeywords").length >= 6);
  assert.match(renderAsaSearch("impression"), /impression-share/);
  assert.match(renderAsaSearch("zzz"), /No Apple Search Ads endpoint matches/);
});

test("renderAppleDoc turns Apple's page JSON into markdown", () => {
  const md = renderAppleDoc(fixture("asa-doc-get-all-campaigns.json"));
  assert.match(md, /^# Get all Campaigns/);
  assert.match(md, /`GET https:\/\/api\.searchads\.apple\.com\/api\/v5\/campaigns`/);
  assert.match(md, /## Query Parameters/);
  assert.match(md, /- `limit` — int32, default 20: The number of items to return per request/);
  assert.match(md, /## Responses/);
  assert.match(md, /- 200 OK `CampaignListResponse`/);
  const object = renderAppleDoc(fixture("asa-doc-campaign.json"));
  assert.match(object, /## Properties/);
  assert.match(object, /- `adamId` \(required\) — int64: Your unique App Store app identifier/);
  assert.match(object, /one of SEARCH, DISPLAY/);
  assert.equal(renderAppleDoc(null), "");
  assert.equal(renderAppleDoc({ primaryContentSections: [{ kind: "unknown" }, "x"] }), "");
});

test("renderAsaOperationDocs stitches the usage, Apple's page, and the body object", async () => {
  const fetched: string[] = [];
  const md = await renderAsaOperationDocs("campaigns", "list", async (url) => {
    fetched.push(url);
    if (url.endsWith("/get-all-campaigns.json")) return fixture("asa-doc-get-all-campaigns.json");
    throw new Error("unexpected");
  });
  assert.deepEqual(fetched, [`${APPLE_DOC_DATA_BASE}/get-all-campaigns.json`]);
  assert.match(md, /## superwall asa campaigns list/);
  assert.match(md, /# Get all Campaigns/);
});

test("renderAsaOperationDocs follows the request body type and reports fetch failures", async () => {
  const withBody = {
    metadata: { title: "Create a Campaign" },
    primaryContentSections: [
      { kind: "restEndpoint", tokens: [{ text: "POST " }, { text: "https://x/v5/campaigns" }] },
      {
        kind: "restBody",
        title: "HTTP Body",
        bodyContentType: [{ kind: "typeIdentifier", identifier: "doc://x/documentation/apple_ads/Campaign", text: "Campaign" }],
        content: [{ type: "paragraph", inlineContent: [{ type: "text", text: "The campaign." }] }],
        parameters: [],
      },
    ],
    references: {},
  };
  const md = await renderAsaOperationDocs("campaigns", "create", async (url) => {
    if (url.endsWith("/create-a-campaign.json")) return withBody;
    if (url.endsWith("/campaign.json")) return fixture("asa-doc-campaign.json");
    throw new Error("unexpected");
  });
  assert.match(md, /## HTTP Body\n`Campaign` — The campaign\./);
  assert.match(md, /## Properties/);

  const failing = await renderAsaOperationDocs("campaigns", "create", async (url) => {
    if (url.endsWith("/create-a-campaign.json")) return withBody;
    throw new Error("offline");
  });
  assert.match(failing, /Couldn't fetch the `Campaign` object page \(offline\)/);

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
