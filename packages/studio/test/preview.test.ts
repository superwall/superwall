import { describe, expect, it } from "vitest";
import { buildPreviewPath } from "../src/lib/preview";
import type { StudioSurface } from "../src/lib/types";

const surface: StudioSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  pageRoutes: ["/"],
  locales: ["en"],
};

describe("buildPreviewPath", () => {
  it("returns a clean path without overrides", () => {
    expect(buildPreviewPath(surface, {})).toBe("/preview/paywall/plus-upgrade");
    expect(buildPreviewPath(surface, { variables: {}, device: {} })).toBe(
      "/preview/paywall/plus-upgrade",
    );
  });

  it("encodes theme, locale, and override payloads", () => {
    const url = new URL(
      buildPreviewPath(surface, {
        theme: "dark",
        locale: "de",
        variables: { defaultPlan: "go", showWebCheckout: false },
        device: { platform: "Android", deviceModel: "Pixel 9" },
      }),
      "http://studio.local",
    );

    expect(url.pathname).toBe("/preview/paywall/plus-upgrade");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.get("locale")).toBe("de");
    expect(JSON.parse(url.searchParams.get("sw_vars") ?? "{}")).toEqual({
      defaultPlan: "go",
      showWebCheckout: false,
    });
    expect(JSON.parse(url.searchParams.get("sw_device") ?? "{}")).toEqual({
      platform: "Android",
      deviceModel: "Pixel 9",
    });
  });
});
