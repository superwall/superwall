import { describe, expect, it } from "vitest";
import { buildPreviewPath, snapshotPreviewUrl, withPreviewOptIn } from "../src/lib/preview";
import type { StudioSurface } from "../src/lib/types";

const surface: StudioSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  routes: ["/"],
  locales: ["en"],
};

describe("buildPreviewPath", () => {
  it("returns a clean path without overrides", () => {
    expect(buildPreviewPath(surface, {})).toBe("/preview/paywall/plus-upgrade");
    expect(buildPreviewPath(surface, { user: {}, device: {} })).toBe(
      "/preview/paywall/plus-upgrade",
    );
  });

  it("encodes theme, locale, and override payloads", () => {
    const url = new URL(
      buildPreviewPath(surface, {
        theme: "dark",
        locale: "de",
        user: { plan: "go", returning: false },
        device: { platform: "Android", deviceModel: "Pixel 9" },
      }),
      "http://studio.local",
    );

    expect(url.pathname).toBe("/preview/paywall/plus-upgrade");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.get("locale")).toBe("de");
    expect(JSON.parse(url.searchParams.get("sw_user") ?? "{}")).toEqual({
      plan: "go",
      returning: false,
    });
    expect(JSON.parse(url.searchParams.get("sw_device") ?? "{}")).toEqual({
      platform: "Android",
      deviceModel: "Pixel 9",
    });
  });
});

describe("withPreviewOptIn", () => {
  it("opts a published snapshot into simulating the SDK", () => {
    expect(withPreviewOptIn("https://cdn.test/p/abc.html")).toBe(
      "https://cdn.test/p/abc.html?sw_preview=1",
    );
    expect(withPreviewOptIn("https://cdn.test/p/abc.html?v=2")).toBe(
      "https://cdn.test/p/abc.html?v=2&sw_preview=1",
    );
  });

  it("never opts in twice", () => {
    expect(withPreviewOptIn("https://cdn.test/p.html?sw_preview=1")).toBe(
      "https://cdn.test/p.html?sw_preview=1",
    );
  });
});

describe("snapshotPreviewUrl", () => {
  const live = { ...surface, label: "v12 · live" };
  const build = snapshotPreviewUrl((entry) =>
    entry === live ? "https://cdn.test/live.html" : "https://cdn.test/other.html",
  );

  it("previews the snapshot a host resolves for the surface, opted in", () => {
    expect(build(live, {})).toBe("https://cdn.test/live.html?sw_preview=1");
    expect(build(surface, {})).toBe("https://cdn.test/other.html?sw_preview=1");
  });

  it("carries the studio's overrides on the same channel local previews use", () => {
    const url = new URL(build(live, { theme: "dark", locale: "de", user: { plan: "go" } }));
    expect(url.searchParams.get("sw_preview")).toBe("1");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.get("locale")).toBe("de");
    expect(JSON.parse(url.searchParams.get("sw_user") ?? "{}")).toEqual({ plan: "go" });
  });
});
