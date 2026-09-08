import { describe, expect, it } from "vitest";
import {
  localResourceUrl,
  parseLocalResourceIds,
  useLocalResource,
  useLocalResources,
} from "../../src/hooks/useLocalResources";
import { flush, renderWithProvider } from "../helpers";

const resources = async (device: Record<string, unknown>) => {
  const { result } = renderWithProvider(() => useLocalResources(), { host: { device } });
  await flush();
  return result.current;
};

describe("useLocalResources", () => {
  it("resolves ids the app registered to swlocal:// and everything else to the fallback", async () => {
    const local = await resources({ localResourceIds: "hero-video,logo" });

    expect(local.ids).toEqual(["hero-video", "logo"]);
    expect(local.has("logo")).toBe(true);
    expect(local.has("missing")).toBe(false);
    expect(local.resolve("hero-video", "https://cdn/hero.mp4")).toBe("swlocal://hero-video");
    expect(local.resolve("missing", "https://cdn/missing.mp4")).toBe("https://cdn/missing.mp4");
  });

  it("is the fallback everywhere the host reports nothing — web, studio, older SDKs", async () => {
    for (const device of [{}, { localResourceIds: "" }, { localResourceIds: undefined }]) {
      const local = await resources(device);
      expect(local.ids).toEqual([]);
      expect(local.resolve("hero-video", "bundled.mp4")).toBe("bundled.mp4");
    }
  });

  it("tolerates the SDK's spacing and stray commas", () => {
    expect(parseLocalResourceIds(" hero , , logo,")).toEqual(["hero", "logo"]);
    expect(parseLocalResourceIds(undefined)).toEqual([]);
    expect(localResourceUrl("hero")).toBe("swlocal://hero");
  });
});

describe("useLocalResource", () => {
  it("is the one-liner form of resolve", async () => {
    const { result } = renderWithProvider(() => useLocalResource("logo", "/logo.png"), {
      host: { device: { localResourceIds: "logo" } },
    });
    await flush();
    expect(result.current).toBe("swlocal://logo");

    const missing = renderWithProvider(() => useLocalResource("logo", "/logo.png"), {
      host: { device: {} },
    });
    await flush();
    expect(missing.result.current).toBe("/logo.png");
  });
});
