import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import type { PaywallDetail } from "@/core/api/resources";
import {
  originBrief,
  originConfigSource,
  originOf,
  parseOriginDocument,
  type OriginDocument,
  type OriginPaywall,
} from "@/core/paywalls/project/origin";

const fixture = (name: string): string =>
  readFileSync(path.join("tests", "fixtures", "origin", `${name}.html`), "utf8");

const detail = (overrides: Partial<PaywallDetail> = {}): PaywallDetail => ({
  id: "65920",
  identifier: "multi-page-with-offer-template-eae3-2025-01-30",
  name: "Increase your revenue",
  archived: false,
  metadata: {},
  applicationId: "5861",
  projectId: "282",
  platform: "ios",
  url: "https://runtime.example/store/document/abc",
  previewUrl: "https://shots.example/abc.png",
  presentationStyle: "fullscreen",
  featureGating: "non_gated",
  products: [{ reference: "primary", identifier: "com.app.pro.year", store: "app-store" }],
  ...overrides,
});

/**
 * The generated config.ts is real source: it has to parse as JavaScript and,
 * with `definePaywall` as the identity, evaluate to exactly the object the
 * origin describes. This is what `superwall push` will read.
 */
const evaluate = (source: string): Record<string, unknown> => {
  assert.match(source, /^import \{ definePaywall \} from "superwall\/config";\n\nexport default definePaywall\(\{\n/);
  assert.match(source, /\n\}\);\n$/);
  const body = source
    .replace(/^import \{ definePaywall \} from "superwall\/config";\n\n/, "")
    .replace(/^export default /, "return ");
  const config: unknown = new Function("definePaywall", body)((value: unknown) => value);
  assert.ok(typeof config === "object" && config !== null);
  return config as Record<string, unknown>;
};

const documentWith = (settings: OriginDocument["settings"], background?: OriginDocument["background"]): OriginDocument => ({
  settings,
  background,
  locales: [],
  inventory: { pages: 1, drawers: 0, nodes: {}, actions: {}, variables: [] },
});

test("a real multi-page template document is read exactly", () => {
  const parsed = parseOriginDocument(fixture("multi-page-template"));
  assert.ok(parsed);
  assert.deepEqual(parsed.settings, {
    presentation: { style: "fullscreen" },
    featureGating: "nonGated",
    scrollEnabled: true,
    gameControllerEnabled: false,
    onDeviceCacheEnabled: true,
  });
  assert.deepEqual(parsed.background, { light: "#ffffff", dark: "#181a1f" });
  assert.deepEqual(parsed.locales, []);
  assert.equal(parsed.inventory.pages, 4);
  assert.equal(parsed.inventory.drawers, 1);
  assert.deepEqual(parsed.inventory.nodes, { stack: 90, navigation: 1, text: 42, img: 14, drawer: 1 });
  assert.deepEqual(parsed.inventory.actions, {
    purchase: 8,
    restore: 1,
    close: 1,
    "open-url": 2,
    "set-state": 10,
    "set-product-index": 6,
  });
  assert.equal(parsed.inventory.variables.length, 16);
  assert.ok(parsed.inventory.variables.includes("products.yearlyPlanTrial.price"));
  assert.ok(
    parsed.inventory.variables.includes(
      "products.yearlyPlanNoTrial.rawPrice | divided_by: 12 | minus: products.monthlyPlanNoTrial.rawPrice | divided_by: products.monthlyPlanNoTrial.rawPrice | times: 100.0 | abs | round",
    ),
  );
});

test("a real single-page gated document is read exactly", () => {
  const parsed = parseOriginDocument(fixture("force-update"));
  assert.ok(parsed);
  assert.deepEqual(parsed.settings, {
    presentation: { style: "fullscreen" },
    featureGating: "gated",
    scrollEnabled: true,
    gameControllerEnabled: false,
    onDeviceCacheEnabled: true,
    webCheckoutDestination: "EXTERNAL",
  });
  assert.deepEqual(parsed.background, { light: "#FFFFFF" });
  assert.deepEqual(parsed.inventory, {
    pages: 1,
    drawers: 0,
    nodes: { img: 1, text: 6, stack: 5 },
    actions: { "open-url": 2 },
    variables: [
      "device.appBuildString",
      "device.appUserId",
      "device.appVersion",
      "device.deviceModel",
      "device.osVersion",
      "device.platform",
      "device.sdkVersion",
      "device.vendorId",
      "products.primary.price",
    ],
  });
});

test("the generated config evaluates to exactly the origin's settings, for every presentation style", () => {
  const cases: Array<[OriginDocument["settings"]["presentation"], Record<string, unknown> | undefined]> = [
    [{ style: "fullscreen" }, undefined],
    [{ style: "modal" }, { style: "modal" }],
    [{ style: "push" }, { style: "push" }],
    [{ style: "noAnimation" }, { style: "noAnimation" }],
    [{ style: "drawer" }, { style: "drawer" }],
    [{ style: "drawer", height: 60 }, { style: "drawer", drawer: { height: 60 } }],
    [{ style: "drawer", cornerRadius: 24 }, { style: "drawer", drawer: { cornerRadius: 24 } }],
    [
      { style: "drawer", height: 60, cornerRadius: 24 },
      { style: "drawer", drawer: { height: 60, cornerRadius: 24 } },
    ],
    [{ style: "popup" }, { style: "popup" }],
    [{ style: "popup", width: 80 }, { style: "popup", popup: { width: 80 } }],
    [
      { style: "popup", width: 80, height: 60, cornerRadius: 15 },
      { style: "popup", popup: { width: 80, height: 60, cornerRadius: 15 } },
    ],
  ];
  for (const [presentation, expected] of cases) {
    const origin = originOf(detail(), documentWith({ presentation }));
    const config = evaluate(originConfigSource(origin));
    assert.deepEqual(
      config,
      {
        name: "Increase your revenue",
        platforms: ["ios"],
        products: { primary: "com.app.pro.year" },
        ...(expected === undefined ? {} : { presentation: expected }),
      },
      JSON.stringify(presentation),
    );
  }
});

test("each setting is written only when it differs from the framework default", () => {
  const base = { name: "Increase your revenue", platforms: ["ios"], products: { primary: "com.app.pro.year" } };
  const flips: Array<[OriginDocument["settings"], Record<string, unknown>]> = [
    [{}, {}],
    [{ featureGating: "gated" }, { featureGating: "gated" }],
    [{ featureGating: "nonGated" }, {}],
    [{ scrollEnabled: false }, { scrollEnabled: false }],
    [{ scrollEnabled: true }, {}],
    [{ gameControllerEnabled: true }, { gameControllerEnabled: true }],
    [{ gameControllerEnabled: false }, {}],
    [{ onDeviceCacheEnabled: false }, { onDeviceCacheEnabled: false }],
    [{ onDeviceCacheEnabled: true }, {}],
    [
      { featureGating: "gated", scrollEnabled: false, gameControllerEnabled: true, onDeviceCacheEnabled: false },
      { featureGating: "gated", scrollEnabled: false, gameControllerEnabled: true, onDeviceCacheEnabled: false },
    ],
  ];
  for (const [settings, expected] of flips) {
    const config = evaluate(originConfigSource(originOf(detail(), documentWith(settings))));
    assert.deepEqual(config, { ...base, ...expected }, JSON.stringify(settings));
  }
});

test("background is written as a string for one color and an object for two", () => {
  assert.deepEqual(
    evaluate(originConfigSource(originOf(detail({ products: [] }), documentWith({}, { light: "#ffffff" })))),
    { name: "Increase your revenue", platforms: ["ios"], background: "#ffffff" },
  );
  assert.deepEqual(
    evaluate(
      originConfigSource(
        originOf(detail({ products: [] }), documentWith({}, { light: "#ffffff", dark: "#181a1f" })),
      ),
    ),
    { name: "Increase your revenue", platforms: ["ios"], background: { light: "#ffffff", dark: "#181a1f" } },
  );
});

test("web checkout is written only for web paywalls, from the editor's destination", () => {
  const web = (destination?: string) =>
    evaluate(
      originConfigSource(
        originOf(
          detail({ platform: "web", products: [] }),
          documentWith(destination === undefined ? {} : { webCheckoutDestination: destination }),
        ),
      ),
    );
  assert.equal(web("PAYWALL_EMBEDDED").checkout, "sheet");
  assert.equal(web("PAYWALL_APPLE_PAY").checkout, "applePay");
  assert.equal(web("EXTERNAL").checkout, undefined);
  assert.equal(web().checkout, undefined);
  const native = evaluate(
    originConfigSource(originOf(detail({ products: [] }), documentWith({ webCheckoutDestination: "PAYWALL_EMBEDDED" }))),
  );
  assert.equal(native.checkout, undefined);
});

test("product references that are not identifiers are quoted, and every product survives", () => {
  const origin = originOf(
    detail({
      products: [
        { reference: "primary", identifier: "com.app.pro.year" },
        { reference: "offer-2", identifier: "com.app.offer" },
        { reference: "with space", identifier: "missing" },
        { reference: "$weird", identifier: 'quote"inside' },
      ],
    }),
  );
  const config = evaluate(originConfigSource(origin));
  assert.deepEqual(config.products, {
    primary: "com.app.pro.year",
    "offer-2": "com.app.offer",
    "with space": "missing",
    $weird: 'quote"inside',
  });
});

test("a name with quotes or backslashes still produces valid source", () => {
  const config = evaluate(
    originConfigSource(originOf(detail({ name: 'Pro "Plus" \\ Deluxe', products: [] }))),
  );
  assert.equal(config.name, 'Pro "Plus" \\ Deluxe');
});

test("an unknown platform writes no platforms line, so push decides", () => {
  const config = evaluate(originConfigSource(originOf(detail({ platform: "visionos", products: [] }))));
  assert.equal(config.platforms, undefined);
});

test("the document's settings beat the API row, and the row fills the gaps", () => {
  const partial = originOf(
    detail({ presentationStyle: "drawer", featureGating: "gated" }),
    documentWith({ scrollEnabled: false }),
  );
  assert.deepEqual(partial.settings, {
    presentation: { style: "drawer" },
    featureGating: "gated",
    scrollEnabled: false,
    gameControllerEnabled: false,
    onDeviceCacheEnabled: true,
  });
  const apiOnly = originOf(detail({ presentationStyle: "no_animation" }));
  assert.deepEqual(apiOnly.settings.presentation, { style: "noAnimation" });
  assert.deepEqual(originOf(detail({ presentationStyle: "push" })).settings.presentation, {
    style: "push",
  });
  assert.deepEqual(originOf(detail({ presentationStyle: "popup" })).settings.presentation, {
    style: "popup",
  });
  assert.deepEqual(originOf(detail({ presentationStyle: undefined })).settings.presentation, {
    style: "fullscreen",
  });
});

const script = (context: unknown, style = "") =>
  `<html><body>${style}<script id="vike_pageContext" type="application/json">${JSON.stringify(context)}</script></body></html>`;

const storeDocument = (store: Record<string, unknown>, style = "") =>
  script({ pageProps: { document: { schema: {}, store } } }, style);

test("the editor store is found wherever the page context nests it, but never inside arrays or too deep", () => {
  const store = { "node:root": { typeName: "node", type: "stack", id: "node:root" } };
  assert.ok(parseOriginDocument(script({ a: { b: { c: { schema: {}, store } } } })));
  assert.equal(parseOriginDocument(script({ list: [{ schema: {}, store }] })), undefined);
  const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { schema: {}, store } } } } } } } } } };
  assert.equal(parseOriginDocument(script(deep)), undefined);
  assert.equal(parseOriginDocument(script({ schema: {} })), undefined);
});

test("presentation falls back from V3 to the legacy style, and to nothing", () => {
  const paywall = (extra: Record<string, unknown>) =>
    parseOriginDocument(storeDocument({ "paywall:paywall": { typeName: "paywall", ...extra } }))?.settings;
  assert.deepEqual(paywall({ presentationStyleV3: { type: "MODAL" }, presentationStyle: "DRAWER" })?.presentation, {
    style: "modal",
  });
  assert.deepEqual(paywall({ presentationStyleV3: { type: "UNKNOWN" }, presentationStyle: "PUSH" })?.presentation, {
    style: "push",
  });
  assert.deepEqual(paywall({ presentationStyle: "NO_ANIMATION" })?.presentation, { style: "noAnimation" });
  assert.deepEqual(paywall({ presentationStyle: "FULLSCREEN" })?.presentation, { style: "fullscreen" });
  assert.deepEqual(
    paywall({ presentationStyleV3: { type: "DRAWER", height: "60", cornerRadius: 24 } })?.presentation,
    { style: "drawer", height: undefined, cornerRadius: 24 },
  );
  assert.deepEqual(
    paywall({ presentationStyleV3: { type: "POPUP", width: 80, height: 60 } })?.presentation,
    { style: "popup", width: 80, height: 60, cornerRadius: undefined },
  );
  assert.equal(paywall({ presentationStyle: "WHATEVER" })?.presentation, undefined);
  assert.equal(paywall({ presentationStyleV3: "MODAL" })?.presentation, undefined);
  assert.deepEqual(paywall({ featureGating: "SOMETHING" }), {});
  assert.deepEqual(paywall({ isScrollEnabled: "MAYBE", onDeviceCache: 1, gameControllerSupport: null }), {});
});

test("background keeps a real alpha, strips an opaque one, and drops a dark color equal to light", () => {
  const style = (light: string, dark?: string) =>
    `<style>html { background-color: ${light} }${dark ? ` html.dark { background-color: ${dark} }` : ""}</style>`;
  const store = { "node:root": { typeName: "node", type: "stack", id: "node:root" } };
  assert.deepEqual(parseOriginDocument(storeDocument(store, style("#0d0f12FF", "#000000ff")))?.background, {
    light: "#0d0f12",
    dark: "#000000",
  });
  assert.deepEqual(parseOriginDocument(storeDocument(store, style("#00000080")))?.background, {
    light: "#00000080",
  });
  assert.deepEqual(parseOriginDocument(storeDocument(store, style("#ffffff", "#ffffff")))?.background, {
    light: "#ffffff",
  });
  assert.equal(parseOriginDocument(storeDocument(store, "<style>html { color: red }</style>"))?.background, undefined);
});

test("locales come from paywall_language ids and ignore malformed ones", () => {
  const parsed = parseOriginDocument(
    storeDocument({
      "paywall_language:fr": { typeName: "paywall_language", id: "paywall_language:fr" },
      "paywall_language:de": { typeName: "paywall_language", id: "paywall_language:de" },
      "paywall_language:x": { typeName: "paywall_language", id: "paywall_language:" },
      "paywall_language:y": { typeName: "paywall_language" },
      "paywall_language:z": { typeName: "paywall_language", id: 42 },
    }),
  );
  assert.deepEqual(parsed?.locales, ["de", "fr"]);
});

test("pages count navigation children only, and a navigation with no children is still one page", () => {
  const nav = {
    "node:nav": { typeName: "node", type: "navigation", id: "node:nav" },
    "node:a": { typeName: "node", type: "stack", id: "node:a", parentId: "node:nav" },
    "node:b": { typeName: "node", type: "stack", id: "node:b", parentId: "node:nav" },
    "node:c": { typeName: "node", type: "stack", id: "node:c", parentId: "node:a" },
    "node:t": { typeName: "node", id: "node:t", parentId: "node:nav" },
  };
  assert.equal(parseOriginDocument(storeDocument(nav))?.inventory.pages, 3);
  assert.equal(
    parseOriginDocument(storeDocument({ "node:nav": { typeName: "node", type: "navigation", id: "node:nav" } }))
      ?.inventory.pages,
    1,
  );
  assert.deepEqual(parseOriginDocument(storeDocument(nav))?.inventory.nodes, { navigation: 1, stack: 3 });
});

test("variables are deduplicated, trimmed, unescaped and sorted; actions are counted by kind", () => {
  const parsed = parseOriginDocument(
    storeDocument({
      "node:1": {
        typeName: "node",
        type: "text",
        id: "node:1",
        props: { text: { text: '{{ products.a.price }} {{products.a.price}} {{ user.name | default: "you" }}' } },
        properties: [
          { type: "property-click-behavior", action: { type: "purchase" } },
          { type: "property-click-behavior", action: { type: "purchase" } },
          { type: "property-click-behavior", action: { type: "request-permission" } },
        ],
      },
    }),
  );
  assert.deepEqual(parsed?.inventory.variables, ['user.name | default: "you"', "products.a.price"].sort());
  assert.deepEqual(parsed?.inventory.actions, { purchase: 2, "request-permission": 1 });
});

test("the brief and config agree on what config.ts carries", () => {
  const origin: OriginPaywall = originOf(detail(), parseOriginDocument(fixture("multi-page-template")));
  const brief = originBrief(origin);
  assert.match(brief, /Pages: 4 \(children of the editor's navigation element/);
  assert.match(brief, /Drawers: 1/);
  assert.match(brief, /Elements: stack ×90, text ×42, img ×14/);
  assert.match(brief, /Actions: set-state ×10, purchase ×8/);
  assert.match(brief, /Locales: none beyond the default/);
  assert.match(brief, /on-device cache, background\. Everything/);
  const localized = originBrief({ ...origin, locales: ["de", "fr"] });
  assert.match(localized, /Locales: de, fr/);
  assert.match(localized, /and the locales to provide catalogs for/);
  const bare = originBrief({ ...origin, background: undefined, inventory: undefined, url: undefined, previewUrl: undefined, identifier: undefined });
  assert.match(bare, /Served document: unknown/);
  assert.match(bare, /Screenshot: none/);
  assert.match(bare, /Dashboard paywall: 65920\n/);
  assert.doesNotMatch(bare, /background/);

  const empty = originBrief({
    ...origin,
    platform: undefined,
    products: [{ reference: "primary", identifier: "com.app.pro" }],
    inventory: { pages: 1, drawers: 0, nodes: {}, actions: {}, variables: [] },
  });
  assert.match(empty, /Platform: unknown/);
  assert.match(empty, /\| `primary` \|  \| `com\.app\.pro` \|/);
  assert.match(empty, /Elements: none/);
  assert.match(empty, /Actions: none/);
  assert.match(empty, /Product variables in text: none/);
  assert.match(empty, /Pages: 1\n/);
});
