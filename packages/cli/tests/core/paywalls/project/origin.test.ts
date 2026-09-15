import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaywallDetail } from "@/core/api/resources";
import {
  originBrief,
  originConfigSource,
  originOf,
  parseOriginDocument,
  slugOf,
} from "@/core/paywalls/project/origin";

const store = {
  "paywall:paywall": {
    typeName: "paywall",
    presentationStyle: "FULLSCREEN",
    presentationStyleV3: { type: "DRAWER", height: 60, cornerRadius: 24 },
    featureGating: "GATED",
    isScrollEnabled: "DISABLED",
    gameControllerSupport: "ENABLED",
    onDeviceCache: "DISABLED",
    webCheckoutDestination: "PAYWALL_EMBEDDED",
  },
  "paywall_language:de": { typeName: "paywall_language", id: "paywall_language:de" },
  "paywall_language:fr": { typeName: "paywall_language", id: "paywall_language:fr" },
  "node:root": { typeName: "node", type: "stack", id: "node:root" },
  "node:nav": { typeName: "node", type: "navigation", id: "node:nav", parentId: "node:root" },
  "node:p1": { typeName: "node", type: "stack", id: "node:p1", parentId: "node:nav" },
  "node:p2": { typeName: "node", type: "stack", id: "node:p2", parentId: "node:nav" },
  "node:p3": { typeName: "node", type: "stack", id: "node:p3", parentId: "node:nav" },
  "node:sheet": { typeName: "node", type: "drawer", id: "node:sheet", parentId: "node:root" },
  "node:t1": {
    typeName: "node",
    type: "text",
    id: "node:t1",
    parentId: "node:p1",
    props: { text: { type: "liquid", text: "{{ products.primary.price }} / {{ products.primary.period }}" } },
  },
  "node:cta": {
    typeName: "node",
    type: "stack",
    id: "node:cta",
    parentId: "node:p1",
    properties: [{ type: "property-click-behavior", action: { type: "purchase" } }],
  },
  "node:link": {
    typeName: "node",
    type: "text",
    id: "node:link",
    parentId: "node:p1",
    properties: [{ type: "property-click-behavior", action: { type: "open-url" } }],
  },
  "node:next": {
    typeName: "node",
    type: "stack",
    id: "node:next",
    parentId: "node:p2",
    properties: [{ type: "property-click-behavior", action: { type: "navigate-page" } }],
  },
};

const html = (body: string) =>
  `<html><head></head><body><style>html { background-color: #0d0f12ff } html.dark { background-color: #000000ff }</style>${body}</body></html>`;

const document = html(
  `<script id="vike_pageContext" type="application/json">${JSON.stringify({
    pageProps: { document: { schema: { schemaVersion: 1 }, store } },
  })}</script>`,
);

const detail: PaywallDetail = {
  id: "65920",
  identifier: "increase-your-revenue-1234-2025-01-01",
  name: "Increase your revenue (Template)",
  archived: false,
  metadata: {},
  applicationId: "5861",
  platform: "ios",
  url: "https://runtime.example/doc/abc",
  previewUrl: "https://shots.example/abc.png",
  presentationStyle: "fullscreen",
  featureGating: "non_gated",
  products: [
    { reference: "primary", identifier: "com.app.pro.year", store: "app-store" },
    { reference: "offer", identifier: "missing", store: "app-store" },
  ],
};

test("parseOriginDocument reads settings, locales, background and an inventory from the served document", () => {
  const parsed = parseOriginDocument(document);
  assert.ok(parsed);
  assert.deepEqual(parsed.settings, {
    presentation: { style: "drawer", height: 60, cornerRadius: 24 },
    featureGating: "gated",
    scrollEnabled: false,
    gameControllerEnabled: true,
    onDeviceCacheEnabled: false,
    webCheckoutDestination: "PAYWALL_EMBEDDED",
  });
  assert.deepEqual(parsed.locales, ["de", "fr"]);
  assert.deepEqual(parsed.background, { light: "#0d0f12", dark: "#000000" });
  assert.equal(parsed.inventory.pages, 3);
  assert.equal(parsed.inventory.drawers, 1);
  assert.deepEqual(parsed.inventory.nodes, { stack: 6, navigation: 1, drawer: 1, text: 2 });
  assert.deepEqual(parsed.inventory.actions, { purchase: 1, "open-url": 1, "navigate-page": 1 });
  assert.deepEqual(parsed.inventory.variables, ["products.primary.period", "products.primary.price"]);
});

test("parseOriginDocument gives up quietly on a document it cannot read", () => {
  assert.equal(parseOriginDocument("<html></html>"), undefined);
  assert.equal(
    parseOriginDocument(html('<script id="vike_pageContext" type="application/json">{nope</script>')),
    undefined,
  );
  assert.equal(
    parseOriginDocument(
      html('<script id="vike_pageContext" type="application/json">{"pageProps":{}}</script>'),
    ),
    undefined,
  );
});

test("a single-page paywall with no navigation counts as one page", () => {
  const single = `<html><body><script id="vike_pageContext" type="application/json">${JSON.stringify(
    {
      document: {
        schema: {},
        store: { "node:root": { typeName: "node", type: "stack", id: "node:root" } },
      },
    },
  )}</script></body></html>`;
  const parsed = parseOriginDocument(single);
  assert.ok(parsed);
  assert.equal(parsed.inventory.pages, 1);
  assert.equal(parsed.background, undefined);
  assert.deepEqual(parsed.settings, {});
});

test("originOf prefers the document's settings and falls back to the API row", () => {
  const withDocument = originOf(detail, parseOriginDocument(document));
  assert.equal(withDocument.slug, "increase-your-revenue");
  assert.equal(withDocument.platform, "ios");
  assert.deepEqual(withDocument.settings.presentation, { style: "drawer", height: 60, cornerRadius: 24 });
  assert.equal(withDocument.settings.featureGating, "gated");
  assert.deepEqual(withDocument.locales, ["de", "fr"]);

  const apiOnly = originOf({ ...detail, presentationStyle: "modal", featureGating: "gated" });
  assert.deepEqual(apiOnly.settings, {
    presentation: { style: "modal" },
    featureGating: "gated",
    scrollEnabled: true,
    gameControllerEnabled: false,
    onDeviceCacheEnabled: true,
  });
  assert.deepEqual(apiOnly.locales, []);
  assert.equal(apiOnly.inventory, undefined);
  assert.equal(originOf({ ...detail, name: undefined, platform: "tvos" }).name, "Paywall 65920");
  assert.equal(originOf({ ...detail, platform: "tvos" }).platform, undefined);
});

test("originConfigSource writes only what differs from the defaults", () => {
  const source = originConfigSource(originOf(detail, parseOriginDocument(document)));
  assert.equal(
    source,
    `import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Increase your revenue (Template)",
  platforms: ["ios"],
  products: {
    primary: "com.app.pro.year",
    offer: "missing",
  },
  presentation: { style: "drawer", drawer: { height: 60, cornerRadius: 24 } },
  background: { light: "#0d0f12", dark: "#000000" },
  featureGating: "gated",
  scrollEnabled: false,
  gameControllerEnabled: true,
  onDeviceCacheEnabled: false,
});
`,
  );

  const minimal = originConfigSource(originOf({ ...detail, products: [], platform: undefined }));
  assert.equal(
    minimal,
    `import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Increase your revenue (Template)",
});
`,
  );

  const web = originConfigSource(
    originOf(
      { ...detail, platform: "web", products: [{ reference: "a b", identifier: "live:price_1" }] },
      parseOriginDocument(document),
    ),
  );
  assert.match(web, /platforms: \["web"\]/);
  assert.match(web, /"a b": "live:price_1"/);
  assert.match(web, /checkout: "sheet"/);

  const popup = originConfigSource(
    originOf({ ...detail, presentationStyle: "popup", products: [] }),
  );
  assert.match(popup, /presentation: \{ style: "popup" \}/);
  const push = originConfigSource(originOf({ ...detail, presentationStyle: "push", products: [] }));
  assert.match(push, /presentation: \{ style: "push" \}/);
});

test("originBrief names the source, the products to fix, and the inventory", () => {
  const brief = originBrief(originOf(detail, parseOriginDocument(document)));
  assert.match(brief, /Dashboard paywall: 65920/);
  assert.match(brief, /https:\/\/runtime\.example\/doc\/abc/);
  assert.match(brief, /\*\*missing\*\*/);
  assert.match(brief, /Pages: 3/);
  assert.match(brief, /purchase ×1/);
  assert.match(brief, /`\{\{ products\.primary\.price \}\}`/);
  assert.match(brief, /Locales: de, fr/);

  const bare = originBrief(originOf({ ...detail, products: [], url: undefined }));
  assert.match(bare, /lists no products/);
  assert.match(bare, /could not be read/);
});

test("slugOf makes a directory name out of a dashboard name", () => {
  assert.equal(slugOf("New York Magazine (Template)"), "new-york-magazine");
  assert.equal(slugOf("  Managed Payments | Stripe + IAP  "), "managed-payments-stripe-iap");
  assert.equal(slugOf("(!!)"), "paywall");
});
