import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { readTeleportBoot } from "../../../src/checkout/teleport/boot";
import { expectedTeleportPageKey, mountApp } from "../../../src/checkout/teleport/pages";
import { PRERENDER_ATTRIBUTE } from "../../../src/document";

const localization = { defaultLocale: "en", messages: { en: {}, de: {}, "pt-BR": {} } };

const boot = (value: Record<string, unknown>) =>
  Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout", ...value });

const device = (properties: Record<string, unknown>) => ({
  variables: { deviceProperties: properties },
});

afterEach(() => {
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
  document.body.replaceChildren();
});

describe("expectedTeleportPageKey", () => {
  it("is nothing off a teleport page or before the trial is known", () => {
    expect(expectedTeleportPageKey(undefined, localization)).toBeUndefined();
    boot(device({ deviceLocale: "de-DE" }));
    expect(expectedTeleportPageKey(readTeleportBoot(), localization)).toBeUndefined();
  });

  it("resolves the locale as the session does: region, then language, then the default", () => {
    boot({
      hasIntroductoryOffer: true,
      productReference: "annual",
      ...device({ deviceLocale: "pt_br" }),
    });
    expect(expectedTeleportPageKey(readTeleportBoot(), localization)).toBe("pt-BR/annual/1");
    boot({ hasIntroductoryOffer: false, ...device({ deviceLocale: "de-AT" }) });
    expect(expectedTeleportPageKey(readTeleportBoot(), localization)).toBe("de/__none__/0");
    boot({ hasIntroductoryOffer: false, ...device({ deviceLanguageCode: "de" }) });
    expect(expectedTeleportPageKey(readTeleportBoot(), localization)).toBe("de/__none__/0");
    boot({ hasIntroductoryOffer: true, ...device({ deviceLocale: "ja-JP" }) });
    expect(expectedTeleportPageKey(readTeleportBoot(), localization)).toBe("en/__none__/1");
    boot({ hasIntroductoryOffer: true });
    expect(expectedTeleportPageKey(readTeleportBoot(), localization)).toBe("en/__none__/1");
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
      mounted = mountApp(element, <p>Jetzt</p>, localization);
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
        mounted = mountApp(element, <p>Jetzt</p>, localization);
      });
      expect(mounted?.hydrated).toBe(false);
      expect(element.innerHTML).toBe("<p>Jetzt</p>");
      if (before !== null) expect(element.firstChild).not.toBe(before);
      expect(element.hasAttribute(PRERENDER_ATTRIBUTE)).toBe(false);
      act(() => mounted?.root.unmount());
    }
  });

  it("renders from scratch off a teleport page", () => {
    const element = container("en/__none__/1", "<p>stale</p>");
    let mounted: ReturnType<typeof mountApp> | undefined;
    act(() => {
      mounted = mountApp(element, <p>Hello</p>, localization);
    });
    expect(mounted?.hydrated).toBe(false);
    expect(element.innerHTML).toBe("<p>Hello</p>");
    act(() => mounted?.root.unmount());
  });
});
