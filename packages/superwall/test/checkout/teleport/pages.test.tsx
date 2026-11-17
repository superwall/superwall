import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { readTeleportBoot } from "../../../src/checkout/teleport/boot";
import { expectedTeleportPageKey, mountApp } from "../../../src/checkout/teleport/pages";
import { PRERENDER_ATTRIBUTE } from "../../../src/document";

const localization = { defaultLocale: "en", messages: { en: {}, de: {}, "pt-BR": {} } };
const config = { localization, teleport: { route: "checkout" } };

const boot = (value: Record<string, unknown>) =>
  Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout", ...value });

const device = (properties: Record<string, unknown>) => ({
  variables: { deviceProperties: properties },
});

afterEach(() => {
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

describe("mountApp", () => {
  const container = (attribute: string | undefined, html: string) => {
    const element = document.createElement("div");
    if (attribute !== undefined) element.setAttribute(PRERENDER_ATTRIBUTE, attribute);
    element.innerHTML = html;
    document.body.append(element);
    return element;
  };

  it("hydrates the matching page, keeping its nodes", () => {
    boot({
      hasIntroductoryOffer: true,
      productReference: "annual",
      ...device({ deviceLocale: "de" }),
    });
    const element = container("de/annual/1", "<p>Jetzt</p>");
    const paragraph = element.firstChild;
    let mounted: ReturnType<typeof mountApp> | undefined;
    act(() => {
      mounted = mountApp(element, <p>Jetzt</p>, config);
    });
    expect(mounted?.hydrated).toBe(true);
    expect(element.firstChild).toBe(paragraph);
    expect(element.hasAttribute(PRERENDER_ATTRIBUTE)).toBe(false);
    act(() => mounted?.root.unmount());
  });

  it("renders from scratch when the page is for another state, empty, or not marked", () => {
    boot({
      hasIntroductoryOffer: true,
      productReference: "annual",
      ...device({ deviceLocale: "de" }),
    });
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
      act(() => mounted?.root.unmount());
    }
  });

  it("renders from scratch when sw_nav reopens another route", () => {
    boot({
      hasIntroductoryOffer: true,
      productReference: "annual",
      ...device({ deviceLocale: "de" }),
    });
    window.history.replaceState(null, "", "/?sw_nav=plan");
    const element = container("de/annual/1", "<p>Jetzt</p>");
    let mounted: ReturnType<typeof mountApp> | undefined;
    act(() => {
      mounted = mountApp(element, <p>Plan</p>, config);
    });
    expect(mounted?.hydrated).toBe(false);
    expect(element.innerHTML).toBe("<p>Plan</p>");
    act(() => mounted?.root.unmount());
  });

  it("renders from scratch off a teleport page", () => {
    const element = container("en/__none__/1", "<p>stale</p>");
    let mounted: ReturnType<typeof mountApp> | undefined;
    act(() => {
      mounted = mountApp(element, <p>Hello</p>, config);
    });
    expect(mounted?.hydrated).toBe(false);
    expect(element.innerHTML).toBe("<p>Hello</p>");
    act(() => mounted?.root.unmount());
  });
});
