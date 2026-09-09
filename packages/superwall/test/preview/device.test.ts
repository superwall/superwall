import { describe, expect, it } from "vitest";
import { paywallSettingsOf } from "../../src/build/settings";
import {
  attachIdentifiers,
  attachSurfaceDetails,
  buildDeviceManifest,
  surfaceDetailsFrom,
} from "../../src/preview/device";

const emptyLock = { version: 1 as const, apps: {}, paywalls: {}, funnels: {} };

describe("buildDeviceManifest", () => {
  it("carries the lock binding for bound surfaces and omits it for unbound ones", () => {
    const manifest = buildDeviceManifest([
      {
        slug: "app",
        surfaces: [
          { kind: "paywall", id: "pro" },
          { kind: "paywall", id: "draft" },
        ],
        lock: { ...emptyLock, paywalls: { pro: { ios: { paywallId: "12345" } } } },
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
          paywalls: { onboarding: { ios: { paywallId: "wrong" } } },
          funnels: { onboarding: { ios: { paywallId: "77" } } },
        },
      },
    ]);
    expect(manifest.surfaces[0]?.paywallId).toBe("77");
  });

  it("lists every app's paywall when a surface is bound to several, first one first", () => {
    const manifest = buildDeviceManifest([
      {
        slug: "app",
        surfaces: [{ kind: "paywall", id: "pro" }],
        lock: {
          ...emptyLock,
          apps: { ios: "1", android: "2" },
          paywalls: { pro: { ios: { paywallId: "12345" }, android: { paywallId: "678" } } },
        },
      },
    ]);
    expect(manifest.surfaces[0]).toEqual({
      kind: "paywall",
      id: "pro",
      url: "/preview/paywall/pro",
      paywallId: "12345",
      paywallIds: ["12345", "678"],
    });
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

describe("attachSurfaceDetails", () => {
  const settings = paywallSettingsOf({ presentation: { style: "drawer" } });

  it("attaches products and settings by surface, and no empty product map", () => {
    const manifest = {
      surfaces: [
        { kind: "paywall", id: "pro", url: "/preview/paywall/pro" },
        { kind: "funnel", id: "onboarding", url: "/preview/funnel/onboarding" },
      ],
    };
    const attached = attachSurfaceDetails(manifest, {
      "paywall/pro": { products: { monthly: "pro_999_month" }, settings },
      "funnel/onboarding": { products: {}, settings },
    });

    expect(attached.surfaces[0]?.products).toEqual({ monthly: "pro_999_month" });
    expect(attached.surfaces[0]?.settings).toEqual(settings);
    expect(attached.surfaces[1]).not.toHaveProperty("products");
    expect(attached.surfaces[1]?.settings).toEqual(settings);
  });

  it("leaves a surface the studio payload never described alone", () => {
    const manifest = { surfaces: [{ kind: "paywall", id: "gone", url: "/preview/paywall/gone" }] };
    expect(attachSurfaceDetails(manifest, {}).surfaces[0]).toEqual(manifest.surfaces[0]);
  });
});

describe("attachIdentifiers", () => {
  it("names bound surfaces by their dashboard identifier and leaves the rest untouched", () => {
    const manifest = {
      surfaces: [
        { kind: "paywall", id: "pro", url: "/preview/paywall/pro", paywallId: "12345" },
        { kind: "paywall", id: "max", url: "/preview/paywall/max", paywallId: "999" },
        { kind: "paywall", id: "draft", url: "/preview/paywall/draft" },
      ],
    };
    const attached = attachIdentifiers(manifest, { "12345": "pro_paywall" });
    expect(attached.surfaces).toEqual([
      { ...manifest.surfaces[0], identifier: "pro_paywall" },
      manifest.surfaces[1],
      manifest.surfaces[2],
    ]);
  });
});

describe("surfaceDetailsFrom", () => {
  it("keys the studio payload the way the manifest looks surfaces up", () => {
    const settings = paywallSettingsOf({});
    expect(
      surfaceDetailsFrom([
        { kind: "paywall", id: "pro", products: { monthly: "pro_month" }, settings },
        { kind: "funnel", id: "onboarding", products: {}, settings },
      ]),
    ).toEqual({
      "paywall/pro": { products: { monthly: "pro_month" }, settings },
      "funnel/onboarding": { products: {}, settings },
    });
  });
});
