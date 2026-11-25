import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTeleportBoot } from "../../../src/checkout/teleport/boot";
import { expectedTeleportPageKey, mountApp } from "../../../src/checkout/teleport/pages";
import { TELEPORT_MARKS } from "../../../src/checkout/teleport/timing";
import { PRERENDER_ATTRIBUTE } from "../../../src/document";

const localization = { defaultLocale: "en", messages: { en: {}, de: {}, "pt-BR": {} } };
const config = { localization, teleport: { route: "checkout" } };

const boot = (value: Record<string, unknown>) =>
  Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout", ...value });

const device = (properties: Record<string, unknown>) => ({
  variables: { deviceProperties: properties },
});

afterEach(() => {
  performance.clearMarks();
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
  window.history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

describe("expectedTeleportPageKey", () => {
  it("is nothing off a teleport page or before the trial is known", () => {
    expect(expectedTeleportPageKey(undefined, config)).toBeUndefined();
    boot(device({ deviceLocale: "de-DE" }));
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBeUndefined();
  });

  it("resolves the locale as the session does: region, then language, then the default", () => {
    boot({
      hasIntroductoryOffer: true,
      productReference: "annual",
      ...device({ deviceLocale: "pt_br" }),
    });
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBe("pt-BR/annual/1");
    boot({ hasIntroductoryOffer: false, ...device({ deviceLocale: "de-AT" }) });
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBe("de/__none__/0");
    boot({ hasIntroductoryOffer: false, ...device({ deviceLanguageCode: "de" }) });
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBe("de/__none__/0");
    boot({ hasIntroductoryOffer: true, ...device({ deviceLocale: "ja-JP" }) });
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBe("en/__none__/1");
    boot({ hasIntroductoryOffer: true });
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBe("en/__none__/1");
    boot({ hasIntroductoryOffer: true, ...device({ deviceLocale: 49 }) });
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBe("en/__none__/1");
  });
});

describe("a product reference no page can be named for", () => {
  it("is nothing for the no-product marker or a dot segment, so no page is ever taken for it", () => {
    for (const productReference of ["__none__", "..", "."]) {
      boot({ hasIntroductoryOffer: true, productReference });
      expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBeUndefined();
    }
    boot({ hasIntroductoryOffer: true, productReference: "v1.2" });
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBe("en/v1.2/1");
  });
});

describe("the route a page opens on", () => {
  const trial = { hasIntroductoryOffer: true, ...device({ deviceLocale: "de" }) };

  it("matches when the page opens on teleport.route, from the boot or sw_nav", () => {
    boot(trial);
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBe("de/__none__/1");
    window.history.replaceState(null, "", "/?sw_nav=checkout");
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBe("de/__none__/1");
  });

  it("is nothing when sw_nav, the boot or the config names another route", () => {
    boot(trial);
    window.history.replaceState(null, "", "/?sw_nav=plan");
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBeUndefined();
    window.history.replaceState(null, "", "/?sw_nav=checkout,plan");
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBeUndefined();
    window.history.replaceState(null, "", "/");
    boot({ ...trial, route: "plan" });
    expect(expectedTeleportPageKey(readTeleportBoot(), config)).toBeUndefined();
    boot(trial);
    expect(expectedTeleportPageKey(readTeleportBoot(), { localization })).toBeUndefined();
    expect(
      expectedTeleportPageKey(readTeleportBoot(), { localization, teleport: true }),
    ).toBeUndefined();
  });
});

const container = (attribute: string | undefined, html: string) => {
  const element = document.createElement("div");
  if (attribute !== undefined) element.setAttribute(PRERENDER_ATTRIBUTE, attribute);
  element.innerHTML = html;
  document.body.append(element);
  return element;
};

const firstPaint = () => performance.getEntriesByName(TELEPORT_MARKS.firstPaint, "mark");

const paint = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
};

const unmount = async (root: Promise<Root> | undefined) => {
  const resolved = await root;
  act(() => resolved?.unmount());
};

const trialInGerman = () =>
  boot({
    hasIntroductoryOffer: true,
    productReference: "annual",
    ...device({ deviceLocale: "de" }),
  });

describe("mountApp", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("leaves the matching page on screen for a frame, then hydrates it, keeping its nodes", async () => {
    trialInGerman();
    const element = container("de/annual/1", "<p>Jetzt</p>");
    const paragraph = element.firstChild;
    const rendered = vi.fn();
    const Page = () => {
      rendered();
      return <p>Jetzt</p>;
    };
    let mounted: ReturnType<typeof mountApp> | undefined;
    act(() => {
      mounted = mountApp(element, <Page />, config);
    });
    expect(mounted?.hydrated).toBe(true);
    expect(rendered).not.toHaveBeenCalled();
    expect(firstPaint()).toEqual([]);
    expect(element.innerHTML).toBe("<p>Jetzt</p>");
    expect(element.hasAttribute(PRERENDER_ATTRIBUTE)).toBe(false);
    await paint();
    expect(rendered).toHaveBeenCalled();
    expect(firstPaint()).toHaveLength(1);
    expect(element.firstChild).toBe(paragraph);
    await unmount(mounted?.root);
  });

  it("hydrates on the fallback timer when the page gets no frames, as in a background tab", async () => {
    trialInGerman();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    const element = container("de/annual/1", "<p>Jetzt</p>");
    const rendered = vi.fn();
    const Page = () => {
      rendered();
      return <p>Jetzt</p>;
    };
    let mounted: ReturnType<typeof mountApp> | undefined;
    act(() => {
      mounted = mountApp(element, <Page />, config);
    });
    await paint();
    expect(rendered).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(rendered).toHaveBeenCalled();
    await unmount(mounted?.root);
  });

  it("renders from scratch at once when the page is for another state, empty, or not marked", async () => {
    trialInGerman();
    for (const [attribute, html] of [
      ["de/annual/0", "<p>stale</p>"],
      ["de/annual/1", ""],
      [undefined, "<p>stale</p>"],
    ] as const) {
      const element = container(attribute, html);
      const before = element.firstChild;
      let mounted: ReturnType<typeof mountApp> | undefined;
      act(() => {
        mounted = mountApp(element, <p>Jetzt</p>, config);
      });
      expect(mounted?.hydrated).toBe(false);
      expect(element.innerHTML).toBe("<p>Jetzt</p>");
      if (before !== null) expect(element.firstChild).not.toBe(before);
      expect(element.hasAttribute(PRERENDER_ATTRIBUTE)).toBe(false);
      await unmount(mounted?.root);
    }
  });

  it("marks first-paint a frame after rendering from scratch", async () => {
    trialInGerman();
    const element = container(undefined, "");
    let mounted: ReturnType<typeof mountApp> | undefined;
    act(() => {
      mounted = mountApp(element, <p>Jetzt</p>, config);
    });
    expect(firstPaint()).toEqual([]);
    await paint();
    expect(firstPaint()).toHaveLength(1);
    await unmount(mounted?.root);
  });

  it("renders from scratch when sw_nav reopens another route", async () => {
    trialInGerman();
    window.history.replaceState(null, "", "/?sw_nav=plan");
    const element = container("de/annual/1", "<p>Jetzt</p>");
    let mounted: ReturnType<typeof mountApp> | undefined;
    act(() => {
      mounted = mountApp(element, <p>Plan</p>, config);
    });
    expect(mounted?.hydrated).toBe(false);
    expect(element.innerHTML).toBe("<p>Plan</p>");
    await unmount(mounted?.root);
  });

  it("renders from scratch off a teleport page and marks nothing", async () => {
    const element = container("en/__none__/1", "<p>stale</p>");
    let mounted: ReturnType<typeof mountApp> | undefined;
    act(() => {
      mounted = mountApp(element, <p>Hello</p>, config);
    });
    expect(mounted?.hydrated).toBe(false);
    expect(element.innerHTML).toBe("<p>Hello</p>");
    await paint();
    expect(firstPaint()).toEqual([]);
    await unmount(mounted?.root);
  });
});
