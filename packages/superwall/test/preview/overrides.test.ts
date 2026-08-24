import { afterEach, describe, expect, it } from "vitest";
import {
  applyThemeOverride,
  mergePreviewSearch,
  readPreviewOverrides,
} from "../../src/preview/overrides";

describe("readPreviewOverrides", () => {
  it("parses theme, locale, and device payloads", () => {
    const overrides = readPreviewOverrides(
      `?theme=dark&locale=de&sw_device=${encodeURIComponent(
        JSON.stringify({ platform: "Android", deviceModel: "Pixel 9" }),
      )}`,
    );
    expect(overrides).toEqual({
      theme: "dark",
      locale: "de",
      device: { platform: "Android", deviceModel: "Pixel 9" },
    });
  });

  it("ignores invalid values", () => {
    expect(readPreviewOverrides("?theme=sepia&sw_device=not-json")).toEqual({});
    expect(readPreviewOverrides("")).toEqual({});
  });
});

describe("mergePreviewSearch", () => {
  it("replaces the studio's own keys and keeps everything else", () => {
    expect(mergePreviewSearch("?theme=light&sw_nav=goal,plan&goal=focus", "?theme=dark")).toBe(
      "?sw_nav=goal%2Cplan&goal=focus&theme=dark",
    );
  });

  it("drops an override the studio no longer sends", () => {
    expect(mergePreviewSearch("?theme=dark&locale=de&sw_nav=goal", "locale=fr")).toBe(
      "?sw_nav=goal&locale=fr",
    );
  });

  it("renders nothing when nothing is left", () => {
    expect(mergePreviewSearch("?theme=dark", "")).toBe("");
  });
});

// jsdom ships no matchMedia; a browser always has one to wrap.
const baseMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;

describe("applyThemeOverride", () => {
  const originalMatchMedia = window.matchMedia;

  const installBaseMatchMedia = () => {
    window.matchMedia = baseMatchMedia;
    return baseMatchMedia;
  };

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.documentElement.style.colorScheme = "";
  });

  it("without an override, restores the host's own matchMedia behavior", () => {
    installBaseMatchMedia();
    // Simulate a live theme flip and back — the studio's instant channel.
    applyThemeOverride("dark");
    applyThemeOverride(undefined);
    expect(document.documentElement.style.colorScheme).toBe("");
    // Delegates to the host stub again (matches: false for everything) —
    // the dark simulation would have answered true for the dark query.
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
    expect(window.matchMedia("(prefers-color-scheme: light)").matches).toBe(false);
  });

  it("survives hosts that do not implement matchMedia", () => {
    // @ts-expect-error — modeling a host without the API at all.
    window.matchMedia = undefined;
    expect(() => applyThemeOverride("dark")).not.toThrow();
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("simulates the scheme at both layers a paywall can observe", () => {
    installBaseMatchMedia();
    applyThemeOverride("dark");

    // UA-level styling…
    expect(document.documentElement.style.colorScheme).toBe("dark");
    // …and JS checks.
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(true);
    expect(window.matchMedia("(prefers-color-scheme: light)").matches).toBe(false);
    // Listener plumbing exists so subscribing code doesn't crash.
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    expect(() => query.addEventListener("change", () => {})).not.toThrow();
    expect(query.dispatchEvent(new Event("change"))).toBe(false);
  });

  it("leaves unrelated media queries to the browser", () => {
    installBaseMatchMedia();
    applyThemeOverride("light");
    expect(window.matchMedia("(min-width: 100px)").media).toBe("(min-width: 100px)");
  });
});

describe("trial eligibility", () => {
  it("reads an explicit yes or no, and nothing otherwise", () => {
    expect(readPreviewOverrides("?sw_trial=1").trialEligible).toBe(true);
    expect(readPreviewOverrides("?sw_trial=0").trialEligible).toBe(false);
    expect(readPreviewOverrides("").trialEligible).toBeUndefined();
    expect(readPreviewOverrides("?sw_trial=maybe").trialEligible).toBeUndefined();
  });
});
