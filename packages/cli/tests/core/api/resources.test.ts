import { test } from "node:test";
import assert from "node:assert/strict";
import { SuperwallApi } from "@/core/api/client";
import {
  createCampaign,
  createEntitlement,
  createHeadlessPaywall,
  createProduct,
  getPaywallApplicationId,
  listAppPaywalls,
  livePaywallVersion,
  listResource,
  pushPaywallAssets,
  pushPaywallVersion,
  rowName,
  versionProducts,
  type Scope,
} from "@/core/api/resources";
import type { Session } from "@/core/auth/storage";

const SESSION: Session = {
  apiKey: "sk_x",
  host: "https://api.example.com",
  createdAt: "n",
};
const api = SuperwallApi.of(SESSION);
const SCOPE: Scope = { projectId: "9", applicationId: "42", projectName: "P" };

interface Rec {
  url: string;
  method?: string;
  body?: unknown;
}
function mockFetch(responder: (url: string) => unknown): Rec[] {
  const recs: Rec[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    recs.push({
      url,
      method: init.method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(responder(url)), { status: 200 });
  }) as typeof fetch;
  return recs;
}

test("listResource scopes products by project_id and campaigns by application_id", async () => {
  let recs = mockFetch(() => ({ data: [], has_more: false }));
  await listResource(api, "products", SCOPE);
  assert.match(recs[0]!.url, /\/v2\/products\?project_id=9/);

  recs = mockFetch(() => ({ data: [], has_more: false }));
  await listResource(api, "campaigns", SCOPE);
  assert.match(recs[0]!.url, /\/v2\/campaigns\?application_id=42/);
});

test("createEntitlement posts {project_id, identifier}", async () => {
  const recs = mockFetch(() => ({ id: 1, identifier: "pro" }));
  await createEntitlement(api, SCOPE, "pro");
  assert.equal(recs[0]!.method, "POST");
  assert.deepEqual(recs[0]!.body, { project_id: "9", identifier: "pro" });
});

test("createProduct includes name only when provided", async () => {
  let recs = mockFetch(() => ({ id: 1 }));
  await createProduct(api, SCOPE, "com.app.pro");
  assert.deepEqual(recs[0]!.body, {
    project_id: "9",
    identifier: "com.app.pro",
  });

  recs = mockFetch(() => ({ id: 1 }));
  await createProduct(api, SCOPE, "com.app.pro", { name: "Pro" });
  assert.deepEqual(recs[0]!.body, {
    project_id: "9",
    identifier: "com.app.pro",
    name: "Pro",
  });
});

test("createCampaign posts placement + holdout audience and requires an app", async () => {
  const recs = mockFetch(() => ({ id: 7 }));
  await createCampaign(api, SCOPE, "My campaign", "onboarding_complete");
  assert.deepEqual(recs[0]!.body, {
    application_id: "42",
    description: "My campaign",
    placements: [{ event_name: "onboarding_complete" }],
    audiences: [{ variants: [{ type: "holdout", percentage: 100, paywall: null }] }],
  });
  assert.throws(() => createCampaign(api, { projectId: "9" }, "x", "p"), /no application/);
});

test("rowName prefers name, then identifier, then id", () => {
  assert.equal(rowName({ id: 1, name: "N", identifier: "I" }), "N");
  assert.equal(rowName({ id: 1, identifier: "I" }), "I");
  assert.equal(rowName({ id: 5 }), "5");
});

test("listAppPaywalls keeps only string metadata and flags the archived query", async () => {
  const recs = mockFetch(() => ({
    data: [
      {
        id: 208540,
        identifier: "plus-upgrade",
        metadata: { headless: "true", headlessSurface: "plus-upgrade", count: 7, nested: {} },
      },
      { id: 9, metadata: null },
    ],
  }));

  const live = await listAppPaywalls(api, "42");
  assert.deepEqual(live, [
    {
      id: "208540",
      identifier: "plus-upgrade",
      archived: false,
      metadata: { headless: "true", headlessSurface: "plus-upgrade" },
    },
    { id: "9", identifier: undefined, archived: false, metadata: {} },
  ]);

  const archived = await listAppPaywalls(api, "42", { archived: true });
  assert.ok(recs[1]?.url.includes("archived=true"));
  assert.equal(archived[0]?.archived, true);
});

test("createHeadlessPaywall always stamps headless so binding can find it again", async () => {
  const recs = mockFetch(() => ({ id: 500 }));

  const created = await createHeadlessPaywall(api, {
    applicationId: "42",
    name: "Plus Upgrade",
    identifier: "plus-upgrade",
  });

  assert.deepEqual(recs[0]?.body, {
    application_id: "42",
    name: "Plus Upgrade",
    identifier: "plus-upgrade",
    headless: true,
  });
  assert.deepEqual(created, {
    id: "500",
    identifier: "plus-upgrade",
    archived: false,
    metadata: {},
  });
});

test("getPaywallApplicationId accepts a numeric id and refuses a missing one", async () => {
  mockFetch(() => ({ id: 208540, application_id: 42 }));
  assert.equal(await getPaywallApplicationId(api, "208540"), "42");

  mockFetch(() => ({ id: 208540 }));
  await assert.rejects(getPaywallApplicationId(api, "208540"), /no application for paywall 208540/);
});

test("livePaywallVersion reads the published version, and stays undefined without one", async () => {
  mockFetch(() => ({ id: 208540, version: 11 }));
  assert.equal(await livePaywallVersion(api, "208540"), 11);

  mockFetch(() => ({ id: 208540 }));
  assert.equal(await livePaywallVersion(api, "208540"), undefined);

  mockFetch(() => ({ id: 208540, version: "11" }));
  assert.equal(await livePaywallVersion(api, "208540"), undefined);
});

test("livePaywallVersion never throws — promote falls back to its single-line output", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  assert.equal(await livePaywallVersion(api, "208540"), undefined);
});

test("pushPaywallVersion omits an empty asset list rather than sending []", async () => {
  const recs = mockFetch(() => ({ version: 7, snapshot_id: "a", url: "u" }));

  await pushPaywallVersion(api, "208540", { html: "<html>", surface: "plus-upgrade", assets: [] });
  assert.deepEqual(recs[0]?.body, { html: "<html>", surface: "plus-upgrade" });

  await pushPaywallVersion(api, "208540", {
    html: "<html>",
    assets: [{ url: "https://x/y.png", mime_type: "image/png" }],
  });
  assert.deepEqual(recs[1]?.body, {
    html: "<html>",
    assets: [{ url: "https://x/y.png", mime_type: "image/png" }],
  });
});

test("pushPaywallAssets drops malformed rows and refuses a response with no list", async () => {
  mockFetch(() => ({
    assets: [
      { sha256: "aaa", url: "https://x/aaa.png", upload_url: "https://put/aaa" },
      { sha256: "bbb", url: "https://x/bbb.png" },
      { sha256: "ccc" },
      { url: "https://x/ddd.png" },
      null,
      "nope",
    ],
  }));

  assert.deepEqual(
    await pushPaywallAssets(api, "208540", [
      { sha256: "aaa", bytes: 1, mime: "image/png", file_name: "aaa.png" },
    ]),
    [
      { sha256: "aaa", url: "https://x/aaa.png", uploadUrl: "https://put/aaa" },
      { sha256: "bbb", url: "https://x/bbb.png" },
    ],
  );

  mockFetch(() => ({}));
  await assert.rejects(
    pushPaywallAssets(api, "208540", [
      { sha256: "aaa", bytes: 1, mime: "image/png", file_name: "aaa.png" },
    ]),
    /returned no asset list/,
  );
});

test("versionProducts maps stripe composites to the stripe store", () => {
  assert.deepEqual(
    versionProducts({
      monthly: "test:price_1SVzqc9XrIjVpXCiS0PfI4wW:no-trial",
      annual: "live:price_abc:trial",
    }),
    [
      {
        store: "stripe",
        identifier: "test:price_1SVzqc9XrIjVpXCiS0PfI4wW:no-trial",
        reference_name: "monthly",
      },
      { store: "stripe", identifier: "live:price_abc:trial", reference_name: "annual" },
    ],
  );
});

test("versionProducts maps store identifiers to app-store", () => {
  assert.deepEqual(versionProducts({ monthly: "pro_999_month" }), [
    { store: "app-store", identifier: "pro_999_month", reference_name: "monthly" },
  ]);
});

test("versionProducts returns empty for no products", () => {
  assert.deepEqual(versionProducts(undefined), []);
  assert.deepEqual(versionProducts({}), []);
});
