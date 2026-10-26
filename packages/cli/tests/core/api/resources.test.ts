import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createSuperwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import {
  createCampaign,
  createEntitlement,
  createHeadlessPaywall,
  createProduct,
  findPaywall,
  listAppPaywalls,
  livePaywall,
  pushedProducts,
  livePaywallVersion,
  listResource,
  pushPaywallAssets,
  pushPaywallVersion,
  rowName,
  versionProducts,
  type Scope,
} from "@/core/api/resources";
import type { Session } from "@/core/account/storage";

const SESSION: Session = {
  apiKey: "sk_x",
  host: "https://api.example.com",
  createdAt: "n",
};
const api = createSuperwallApi(SESSION);
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

test("createProduct sends application_id only when one is given", async () => {
  const recs = mockFetch(() => ({ id: 1 }));
  await createProduct(api, SCOPE, "test:price_1:7days-free", { applicationId: "57397" });
  assert.deepEqual(recs[0]!.body, {
    project_id: "9",
    application_id: "57397",
    identifier: "test:price_1:7days-free",
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

test("getPaywall reads a numeric application id, and leaves a missing one undefined", async () => {
  mockFetch(() => ({ id: 208540, application_id: 42 }));
  assert.equal((await findPaywall(api, "208540")).applicationId, "42");

  mockFetch(() => ({ id: 208540 }));
  assert.equal((await findPaywall(api, "208540")).applicationId, undefined);
});

test("pushedProducts reads the newest version of a snapshot, and nothing for one never pushed", async () => {
  mockFetch(() => ({
    object: "list",
    data: [
      { version: 2, snapshot_id: "s1", products: [{ reference_name: "a", identifier: "x", store: "custom" }] },
      { version: 1, snapshot_id: "s1", products: [{ reference_name: "a", identifier: "x", store: "app-store" }] },
      { version: 3, snapshot_id: "s2", products: [] },
      { version: "4", snapshot_id: "s1" },
      "junk",
    ],
  }));
  assert.deepEqual(await pushedProducts(api, "208540", "s1"), [
    { reference: "a", identifier: "x", store: "custom" },
  ]);
  assert.equal(await pushedProducts(api, "208540", "s9"), undefined);

  mockFetch(() => ({ object: "list" }));
  assert.equal(await pushedProducts(api, "208540", "s1"), undefined);
});

test("versionProducts reads only the catalogue's own entries, whatever an identifier is called", () => {
  assert.deepEqual(
    versionProducts({ a: "constructor", b: "toString", c: "__proto__" }, "ios", {}).map(
      (product) => product.store,
    ),
    ["app-store", "app-store", "app-store"],
  );
  assert.equal(
    versionProducts({ a: "constructor" }, "ios", Object.fromEntries([["constructor", ["custom"]]]))[0]
      ?.store,
    "custom",
  );
});

test("livePaywallVersion reads the published version, and stays undefined without one", async () => {
  mockFetch(() => ({ id: 208540, version: 11 }));
  assert.equal(await livePaywallVersion(api, "208540"), 11);

  mockFetch(() => ({ id: 208540 }));
  assert.equal(await livePaywallVersion(api, "208540"), undefined);

  mockFetch(() => ({ id: 208540, version: "11" }));
  assert.equal(await livePaywallVersion(api, "208540"), undefined);
});

test("livePaywallVersion tolerates an outage — promote falls back to its single-line output", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  assert.equal(await livePaywallVersion(api, "208540"), undefined);

  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.equal(await livePaywallVersion(api, "208540"), undefined);
});

for (const status of [401, 403, 404]) {
  test(`livePaywall surfaces a ${status} instead of reading it as never published`, async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "no" }), { status })) as typeof fetch;
    await assert.rejects(livePaywall(api, "208540"), (error: unknown) => error instanceof ApiError && error.status === status);
  });
}

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

test("versionProducts sends Play Store for an android build, and never for stripe", () => {
  assert.deepEqual(
    versionProducts({ monthly: "pro_999_month", web: "live:price_abc:trial" }, "android"),
    [
      { store: "play-store", identifier: "pro_999_month", reference_name: "monthly" },
      { store: "stripe", identifier: "live:price_abc:trial", reference_name: "web" },
    ],
  );
  assert.equal(versionProducts({ monthly: "pro_999_month" }, "ios")[0]?.store, "app-store");
  assert.equal(versionProducts({ monthly: "pro_999_month" }, "flutter")[0]?.store, "app-store");
});

test("pushPaywallVersion spreads the paywall settings into the version body", async () => {
  const posted: { path: string; body: unknown }[] = [];
  const fake = {
    post: async (path: string, body: unknown) => {
      posted.push({ path, body });
      return { version: 1, snapshot_id: "s", url: "u" };
    },
  } as unknown as SuperwallApi;

  await pushPaywallVersion(fake, "1", {
    html: "<html></html>",
    settings: {
      presentation_style: { type: "DRAWER", height: 70, corner_radius: 15 },
      feature_gating: "gated",
      on_device_cache: false,
      scroll_enabled: true,
      game_controller_enabled: false,
    },
  });

  assert.deepEqual(posted[0]?.body, {
    html: "<html></html>",
    presentation_style: { type: "DRAWER", height: 70, corner_radius: 15 },
    feature_gating: "gated",
    on_device_cache: false,
    scroll_enabled: true,
    game_controller_enabled: false,
  });

  await pushPaywallVersion(fake, "1", { html: "<html></html>" });
  assert.deepEqual(posted[1]?.body, { html: "<html></html>" });
});

test("versionProducts takes a custom or Stripe store from the catalogue, and the platform's store when the catalogue has it", () => {
  const stores = {
    stripe_elite1w: ["custom" as const],
    prod_web: ["stripe" as const],
    shared: ["custom" as const, "app-store" as const],
    pro_play: ["play-store" as const],
  };
  assert.deepEqual(
    versionProducts(
      {
        stripePrimary: "stripe_elite1w",
        web: "prod_web",
        shared: "shared",
        play: "pro_play",
        unknown: "pro_999_month",
        composite: "live:price_abc:trial",
      },
      "ios",
      stores,
    ).map((product) => product.store),
    ["custom", "stripe", "app-store", "app-store", "app-store", "stripe"],
  );
  assert.equal(versionProducts({ shared: "shared" }, "android", stores)[0]?.store, "custom");
});

test("versionProducts returns empty for no products", () => {
  assert.deepEqual(versionProducts(undefined), []);
  assert.deepEqual(versionProducts({}), []);
});

test("pushPaywallVersion spreads background and checkout destination from the settings block, only when present", async () => {
  const calls: Record<string, unknown>[] = [];
  const api = {
    post: async (_path: string, body: Record<string, unknown>) => {
      calls.push(body);
      return { version: 1, snapshot_id: "s", url: "u" };
    },
  } as unknown as SuperwallApi;
  const base = {
    presentation_style: { type: "FULLSCREEN" as const },
    feature_gating: "non_gated" as const,
    on_device_cache: true,
    scroll_enabled: true,
    game_controller_enabled: false,
  };

  await pushPaywallVersion(api, "1", {
    html: "<html>",
    settings: {
      ...base,
      background_color_hex: "#ffffff",
      dark_background_color_hex: "#000000",
      web_checkout_destination: "PAYWALL_EMBEDDED",
    },
  });
  assert.equal(calls[0]?.background_color_hex, "#ffffff");
  assert.equal(calls[0]?.dark_background_color_hex, "#000000");
  assert.equal(calls[0]?.web_checkout_destination, "PAYWALL_EMBEDDED");

  await pushPaywallVersion(api, "1", { html: "<html>", settings: base });
  assert.ok(!("background_color_hex" in (calls[1] ?? {})));
  assert.ok(!("dark_background_color_hex" in (calls[1] ?? {})));
  assert.ok(!("web_checkout_destination" in (calls[1] ?? {})));
});
