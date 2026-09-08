import { describe, expect, it } from "vitest";
import { buildPreviewPath, hostedUrl, snapshotPreviewUrl, surfacePath } from "../src/lib/preview";
import type { StudioSurface } from "../src/lib/types";

const surface: StudioSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  routes: ["/"],
  locales: ["en"],
};

describe("buildPreviewPath", () => {
  it("loads the dev preview with the editor transport and nothing else", () => {
    expect(buildPreviewPath(surface)).toBe("/preview/paywall/plus-upgrade?transport=editor");
    expect(buildPreviewPath({ ...surface, project: "acme" })).toBe(
      "/preview/acme/paywall/plus-upgrade?transport=editor",
    );
  });

  it("routes the studio itself by surface", () => {
    expect(surfacePath(surface)).toBe("/paywall/plus-upgrade");
  });
});

describe("hostedUrl", () => {
  it("asks a snapshot to talk to its parent window", () => {
    expect(hostedUrl("https://cdn.test/p/abc.html")).toBe(
      "https://cdn.test/p/abc.html?transport=editor",
    );
    expect(hostedUrl("https://cdn.test/p/abc.html?v=2")).toBe(
      "https://cdn.test/p/abc.html?v=2&transport=editor",
    );
  });

  it("never asks twice", () => {
    expect(hostedUrl("https://cdn.test/p.html?transport=editor")).toBe(
      "https://cdn.test/p.html?transport=editor",
    );
    expect(hostedUrl("https://cdn.test/p.html?transport=editor&v=2")).toBe(
      "https://cdn.test/p.html?transport=editor&v=2",
    );
  });
});

describe("snapshotPreviewUrl", () => {
  const live = { ...surface, label: "v12 · live" };
  const build = snapshotPreviewUrl((entry) =>
    entry === live ? "https://cdn.test/live.html" : "https://cdn.test/other.html",
  );

  it("previews the snapshot a host resolves for the surface, hosted", () => {
    expect(build(live)).toBe("https://cdn.test/live.html?transport=editor");
    expect(build(surface)).toBe("https://cdn.test/other.html?transport=editor");
  });
});
