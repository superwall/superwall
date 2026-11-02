// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseAst } from "vite";
import {
  inlineProductsOf,
  resolveBillingPlans,
  resolveProductIds,
  rewriteConfigProducts,
} from "../../src/build/products";
import type { DiscoveredSurface } from "../../src/discover";

const surface: DiscoveredSurface = {
  kind: "paywall",
  id: "pro",
  dir: "/app/superwall/paywalls/pro",
  configFile: "/app/superwall/paywalls/pro/config.ts",
  routes: [],
  messages: [],
  diagnostics: [],
};

describe("resolveProductIds", () => {
  it("resolves each slot for the platform being built", () => {
    expect(
      resolveProductIds(
        {
          products: {
            annual: { ios: "a_ios", android: "a_play" },
            monthly: "m",
            slot: { productId: "s" },
          },
        },
        surface,
        "android",
      ),
    ).toEqual({ annual: "a_play", monthly: "m", slot: "s" });
    expect(resolveProductIds({}, surface, undefined)).toEqual({});
  });

  it("keeps the reference for an empty slot when no platform is given", () => {
    expect(resolveProductIds({ products: { placeholder: {} } }, surface, undefined)).toEqual({
      placeholder: "placeholder",
    });
  });

  it("refuses a platform build with slots that have no id for it", () => {
    expect(() =>
      resolveProductIds({ products: { annual: { ios: "a" } } }, surface, "android"),
    ).toThrow("paywalls/pro: `annual` has no product id for android");
    expect(() =>
      resolveProductIds(
        { products: { annual: { ios: "a" }, weekly: { ios: "w" } } },
        surface,
        "android",
      ),
    ).toThrow("`annual`, `weekly` have no product id for android");
  });
});

describe("resolveBillingPlans", () => {
  const config = {
    products: {
      annual: { productId: "pro_annual", billingPlan: "upFront" },
      annualMonthly: { productId: "pro_annual", billingPlan: "monthly" },
      perPlatform: { ios: "a_ios", android: "a_play", billingPlan: "upFront" },
      plain: "m",
      noPlan: { productId: "w" },
    },
  } as const;

  it("maps each slot that declares a plan, side by side on one product", () => {
    expect(resolveBillingPlans(config, surface, "ios")).toEqual({
      annual: "upFront",
      annualMonthly: "monthly",
      perPlatform: "upFront",
    });
    expect(resolveBillingPlans(config, surface, undefined)).toEqual({
      annual: "upFront",
      annualMonthly: "monthly",
      perPlatform: "upFront",
    });
    expect(resolveBillingPlans(config, surface, "web")).toEqual({
      annual: "upFront",
      annualMonthly: "monthly",
      perPlatform: "upFront",
    });
    expect(resolveBillingPlans({}, surface, "ios")).toEqual({});
  });

  it("carries no plan on an Android build, where the App Store plan does not exist", () => {
    expect(resolveBillingPlans(config, surface, "android")).toEqual({});
  });

  it("refuses an unknown plan with the slot that declares it, on every platform", () => {
    const typo = { products: { annual: { productId: "a", billingPlan: "upfront" } } };
    for (const platform of ["ios", "android", undefined] as const) {
      expect(() =>
        // @ts-expect-error a typo the type rejects; config.ts can still be loose JS
        resolveBillingPlans(typo, surface, platform),
      ).toThrow(
        'paywalls/pro: `annual` billingPlan must be one of "monthly", "upFront", got "upfront".',
      );
    }
  });
});

describe("inlineProductsOf", () => {
  it("bakes Superwall's variables for the Stripe slots it knows, and nothing for store products", () => {
    const catalogue = {
      "live:price_1:14days-free": { price: "$59.99", trialPeriodDays: 14 },
      pro_year: { price: "$39.99" },
    };
    expect(
      inlineProductsOf(
        {
          card14: "live:price_1:14days-free",
          cardNow: "live:price_1:no-trial",
          annual: "pro_year",
        },
        catalogue,
      ),
    ).toEqual({ card14: { price: "$59.99", trialPeriodDays: 14 } });
    expect(inlineProductsOf({ card14: "live:price_1:14days-free" }, undefined)).toEqual({});
    expect(
      inlineProductsOf(
        { card14: "live:price_1:14days-free" },
        { "live:price_1:14days-free": { identifier: "live:price_1:14days-free" } },
      ),
    ).toEqual({});
  });
});

describe("rewriteConfigProducts", () => {
  const resolved = { annual: "play" };
  const rewrite = (code: string) => rewriteConfigProducts(code, parseAst(code), resolved);

  it("replaces the products literal inside definePaywall(...) and inside a bare object", () => {
    expect(rewrite('export default definePaywall({ name: "x", products: { annual: "a" } });')).toBe(
      'export default definePaywall({ name: "x", products: {"annual":"play"} });',
    );
    expect(rewrite('export default { "products": ["ignored"] };')).toBe(
      'export default { "products": {"annual":"play"} };',
    );
  });

  it("skips computed and spread members on its way to products", () => {
    expect(rewrite("export default { [key]: 1, ...shared, other: 2, products: {} };")).toBe(
      'export default { [key]: 1, ...shared, other: 2, products: {"annual":"play"} };',
    );
  });

  it("leaves shapes it cannot see through alone", () => {
    for (const code of [
      "const c = { products: {} }; export default c;",
      "export default definePaywall({ ...shared });",
      "export default definePaywall(build());",
      "export default function () {}",
      "export default { name: 1 };",
      "export const x = 1;",
    ]) {
      expect(rewrite(code)).toBeUndefined();
    }
  });
});

const program = (body: unknown[]) => ({ body: body as { type: string }[] });

describe("rewriteConfigProducts on shapes a parser can produce", () => {
  const rewrite = (body: unknown[]) =>
    rewriteConfigProducts("export default {};", program(body), { annual: "play" });

  it("gives up on an export with no declaration to read", () => {
    expect(rewrite([{ type: "ExportDefaultDeclaration" }])).toBeUndefined();
  });

  it("skips members whose key it cannot name", () => {
    expect(
      rewrite([
        {
          type: "ExportDefaultDeclaration",
          declaration: {
            type: "ObjectExpression",
            properties: [
              "not an object",
              null,
              { type: "SpreadElement" },
              { type: "Property" },
              { type: "Property", key: "a string key" },
              { type: "Property", key: { type: "Identifier" } },
              { type: "Property", key: { type: "Literal" } },
              { type: "Property", key: { type: "PrivateIdentifier", name: "products" } },
            ],
          },
        },
      ]),
    ).toBeUndefined();
  });

  it("gives up on a products member it cannot locate in the source", () => {
    const withValue = (value: unknown) =>
      rewrite([
        {
          type: "ExportDefaultDeclaration",
          declaration: {
            type: "ObjectExpression",
            properties: [
              { type: "Property", key: { type: "Identifier", name: "products" }, value },
            ],
          },
        },
      ]);
    expect(withValue(undefined)).toBeUndefined();
    expect(withValue(null)).toBeUndefined();
    expect(withValue({ type: "ObjectExpression" })).toBeUndefined();
    expect(withValue({ type: "ObjectExpression", start: 0 })).toBeUndefined();
    expect(withValue({ type: "ObjectExpression", start: "0", end: 2 })).toBeUndefined();
  });

  it("gives up on a call with no arguments to read", () => {
    expect(
      rewrite([
        {
          type: "ExportDefaultDeclaration",
          declaration: { type: "CallExpression", arguments: "not a list" },
        },
      ]),
    ).toBeUndefined();
  });
});
