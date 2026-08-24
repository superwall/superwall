import { describe, expect, it } from "vitest";
import { attachProducts, buildDeviceManifest } from "../../src/preview/device";

const emptyLock = { version: 1 as const, paywalls: {}, funnels: {} };

describe("buildDeviceManifest", () => {
  it("carries the lock binding for bound surfaces and omits it for unbound ones", () => {
    const manifest = buildDeviceManifest([
      {
        slug: "app",
        surfaces: [
          { kind: "paywall", id: "pro" },
          { kind: "paywall", id: "draft" },
        ],
        lock: { ...emptyLock, paywalls: { pro: { paywallId: "12345" } } },
      },
    ]);
    expect(manifest.surfaces).toEqual([
      { kind: "paywall", id: "pro", url: "/preview/paywall/pro", paywallId: "12345" },
      { kind: "paywall", id: "draft", url: "/preview/paywall/draft" },
    ]);
  });

  it("binds funnels from the funnel map, not the paywall map", () => {
    const manifest = buildDeviceManifest([
      {
        slug: "app",
        surfaces: [{ kind: "funnel", id: "onboarding" }],
        lock: {
          ...emptyLock,
          paywalls: { onboarding: { paywallId: "wrong" } },
          funnels: { onboarding: { paywallId: "77" } },
        },
      },
    ]);
    expect(manifest.surfaces[0]?.paywallId).toBe("77");
  });

  it("prefixes urls with the project slug when several projects are served", () => {
    const manifest = buildDeviceManifest([
      { slug: "alpha", surfaces: [{ kind: "paywall", id: "pro" }], lock: emptyLock },
      { slug: "beta", surfaces: [{ kind: "paywall", id: "max" }], lock: emptyLock },
    ]);
    expect(manifest.surfaces.map((surface) => surface.url)).toEqual([
      "/preview/alpha/paywall/pro",
      "/preview/beta/paywall/max",
    ]);
  });
});

describe("attachProducts", () => {
  it("attaches config products by surface and leaves productless surfaces alone", () => {
    const manifest = {
      surfaces: [
        { kind: "paywall", id: "pro", url: "/preview/paywall/pro" },
        { kind: "funnel", id: "onboarding", url: "/preview/funnel/onboarding" },
      ],
    };
    const attached = attachProducts(manifest, {
      "paywall/pro": { monthly: "pro_999_month" },
      "funnel/onboarding": {},
    });
    expect(attached.surfaces[0]?.products).toEqual({ monthly: "pro_999_month" });
    expect(attached.surfaces[1]).not.toHaveProperty("products");
  });
});
