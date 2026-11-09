import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReturnDim,
  arrowPaths,
  hintLayout,
  openButtonAnchor,
  createTeleportScreen,
  poweredByHref,
} from "../../../src/checkout/teleport/screen";

const safari = (version: string) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Mobile/15E148 Safari/604.1`;

const options = {
  surface: "overlay" as const,
  role: "dialog" as const,
  title: "Finish in your browser",
  body: "Complete your purchase there.",
  actions: [],
};

const move = (target: EventTarget | null | undefined) => {
  const event = new Event("touchmove", { cancelable: true, bubbles: true });
  target?.dispatchEvent(event);
  return event.defaultPrevented;
};

const phoneWindow = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  Object.defineProperty(window.screen, "width", { configurable: true, value: width });
  Object.defineProperty(window.screen, "height", { configurable: true, value: height });
};

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll(".sw-teleport, .sw-teleport-dim").forEach((node) => node.remove());
  document.getElementById("sw-teleport-style")?.remove();
});

describe("the teleport screen, as paywall.js draws it", () => {
  it("adds its stylesheet once, defaults to left to right, and names an unbranded footer as is", () => {
    createTeleportScreen({ ...options, footer: { label: "Powered by Acme", href: "https://x" } });
    createTeleportScreen({ ...options });
    expect(document.querySelectorAll("#sw-teleport-style")).toHaveLength(1);
    const [first] = document.querySelectorAll<HTMLElement>(".sw-teleport");
    expect(first?.dir).toBe("ltr");
    expect(first?.querySelector(".sw-teleport-footer-text")?.textContent).toBe("Powered by Acme");
    expect(first?.querySelector(".sw-teleport-footer-brand")).toBeNull();
  });

  it("lets the message scroll inside when it overflows, and nothing else", () => {
    const screen = createTeleportScreen({ ...options });
    const message = screen.root.querySelector(".sw-teleport-message");
    expect(move(message)).toBe(true);
    screen.root.setAttribute("data-overflow", "");
    expect(move(message)).toBe(false);
    expect(move(screen.root)).toBe(true);
    const wheel = new Event("wheel", { cancelable: true });
    screen.root.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    screen.remove({ instant: true });
    expect(move(screen.root)).toBe(false);
  });

  it("leaves after its exit transition, or its timer, and only once", () => {
    vi.useFakeTimers();
    const screen = createTeleportScreen({ ...options });
    screen.remove();
    screen.remove({ instant: true });
    expect(screen.root.dataset.state).toBe("closing");
    expect(screen.root.isConnected).toBe(true);
    screen.root.dispatchEvent(new Event("transitionend"));
    expect(screen.root.isConnected).toBe(false);

    const timed = createTeleportScreen({ ...options });
    timed.remove();
    timed.root.firstElementChild?.dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(timed.root.isConnected).toBe(true);
    vi.advanceTimersByTime(250);
    expect(timed.root.isConnected).toBe(false);
  });

  it("credits the subdomain it was served from", () => {
    expect(new URL(poweredByHref()).searchParams.get("utm_source")).toBe("localhost");
  });

  it("shows one hint on the dim, mirrored by its direction, and none once the dim is leaving", () => {
    const dim = createReturnDim();
    phoneWindow(402, 874);
    dim.showHint("Tap to return to the app", "rtl");
    dim.showHint("Again", "ltr");
    const hints = dim.root.querySelectorAll<HTMLElement>(".sw-teleport-dim-hint");
    expect(hints).toHaveLength(1);
    expect(hints[0]?.dir).toBe("rtl");
    expect(hints[0]?.querySelector(".sw-teleport-dim-caption")?.textContent).toBe(
      "Tap to return to the app",
    );

    expect(hints[0]?.dataset.side).toBe("ltr");
    const arrow = hints[0]?.querySelectorAll(".sw-teleport-dim-arrow path");
    expect(arrow).toHaveLength(2);
    expect(arrow?.[0]?.getAttribute("d")).toMatch(
      new RegExp(` ${window.innerWidth - 61.5} [\\d.]+$`),
    );

    const leaving = createReturnDim();
    leaving.remove();
    leaving.showHint("Late", "ltr");
    expect(leaving.root.querySelector(".sw-teleport-dim-hint")).toBeNull();
  });

  it.each([
    [
      "iOS 27.2, page under the bars",
      {
        userAgent: safari("27.2"),
        innerWidth: 402,
        innerHeight: 874,
        screenWidth: 402,
        screenHeight: 874,
      },
      340.5,
      457.7,
    ],
    [
      "iOS 26.5, page under the bars",
      {
        userAgent: safari("26.5"),
        innerWidth: 440,
        innerHeight: 956,
        screenWidth: 440,
        screenHeight: 956,
      },
      378.5,
      498.7,
    ],
    [
      "iOS 26.5, page between the bars",
      {
        userAgent: safari("26.5"),
        innerWidth: 402,
        innerHeight: 714,
        screenWidth: 402,
        screenHeight: 874,
      },
      340.5,
      395.7,
    ],
    [
      "iOS 18.6",
      {
        userAgent: safari("18.6"),
        innerWidth: 402,
        innerHeight: 678,
        screenWidth: 402,
        screenHeight: 874,
      },
      340.5,
      377.5,
    ],
    [
      "iOS 18.6 on a 375 pt screen",
      {
        userAgent: safari("18.6"),
        innerWidth: 375,
        innerHeight: 547,
        screenWidth: 375,
        screenHeight: 667,
      },
      313.5,
      312,
    ],
    [
      "iOS 17.5 on a 375 pt screen",
      {
        userAgent: safari("17.5"),
        innerWidth: 375,
        innerHeight: 547,
        screenWidth: 375,
        screenHeight: 667,
      },
      313.5,
      308.8,
    ],
    [
      "a browser that isn't Safari",
      {
        userAgent: "CriOS/140",
        innerWidth: 402,
        innerHeight: 874,
        screenWidth: 402,
        screenHeight: 874,
      },
      340.5,
      457.7,
    ],
  ])("puts Open's bottom centre where %s draws it", (_, view, x, y) => {
    const anchor = openButtonAnchor({ language: "en-US", ...view });
    expect(anchor?.x).toBeCloseTo(x, 1);
    expect(anchor?.y).toBeCloseTo(y, 1);
    expect(anchor?.side).toBe("ltr");
  });

  it("leaves the same gap from the alert to the arrow as from the arrow's tail to the caption", () => {
    const layout = hintLayout({ x: 340.5, y: 457.7, side: "ltr" }, 402);
    expect(layout.tipY - 1.5 - (457.7 + 10)).toBeCloseTo(14, 5);
    expect(layout.tipX).toBe(340.5);
    expect(layout.tailX).toBe(288.5);
    expect(layout.tailY).toBeCloseTo(layout.tipY + 56, 5);
    expect(layout.tailX - 1.5 - (layout.captionLeft + layout.captionWidth)).toBeCloseTo(14, 5);
    expect(layout).toMatchObject({ captionLeft: 24, captionAlign: "right" });
  });

  it("puts the caption on the arrow's other side when Open is on the left", () => {
    const layout = hintLayout({ x: 61.5, y: 457.7, side: "rtl" }, 402);
    expect(layout.tailX).toBe(113.5);
    expect(layout.captionLeft - 1.5 - layout.tailX).toBeCloseTo(14, 5);
    expect(layout.captionLeft + layout.captionWidth).toBeCloseTo(402 - 24, 5);
    expect(layout.captionAlign).toBe("left");
    expect(hintLayout({ x: 30, y: 0, side: "ltr" }, 60).captionWidth).toBe(0);
  });

  it("draws one curve that leaves the caption sideways and ends pointing straight up at Open", () => {
    const layout = hintLayout({ x: 340.5, y: 457.7, side: "ltr" }, 402);
    const [arc, head] = arrowPaths(layout);
    expect(arc).toBe("M288.5 539.2Q340.5 539.2 340.5 483.2");
    expect(head).toBe("M347.6 490.3L340.5 483.2L333.4 490.3");
    const [mirrored] = arrowPaths(hintLayout({ x: 61.5, y: 457.7, side: "rtl" }, 402));
    expect(mirrored).toBe("M113.5 539.2Q61.5 539.2 61.5 483.2");
  });

  it("leaves the arrow out on an iPad or a phone held sideways, where nobody measured the alert", () => {
    const phone = {
      userAgent: safari("27.2"),
      language: "en-US",
      innerWidth: 402,
      innerHeight: 874,
      screenWidth: 402,
      screenHeight: 874,
    };
    expect(openButtonAnchor(phone)).toBeDefined();
    expect(
      openButtonAnchor({
        ...phone,
        innerWidth: 1024,
        innerHeight: 1292,
        screenWidth: 1024,
        screenHeight: 1366,
      }),
    ).toBeUndefined();
    expect(openButtonAnchor({ ...phone, innerWidth: 874, innerHeight: 402 })).toBeUndefined();

    phoneWindow(874, 402);
    const sideways = createReturnDim();
    sideways.showHint("Tap to return to the app", "ltr");
    expect(sideways.root.querySelector(".sw-teleport-dim-hint")).toBeNull();
    expect(sideways.root.isConnected).toBe(true);
  });

  it("puts Open on the left when the phone, not the paywall, reads right to left", () => {
    const view = {
      userAgent: safari("27.2"),
      innerWidth: 402,
      innerHeight: 874,
      screenWidth: 402,
      screenHeight: 874,
    };
    expect(openButtonAnchor({ ...view, language: "ar" })).toMatchObject({ x: 61.5, side: "rtl" });
    expect(openButtonAnchor({ ...view, language: "he-IL" })?.side).toBe("rtl");
    expect(openButtonAnchor({ ...view, language: "de-DE" })).toMatchObject({
      x: 340.5,
      side: "ltr",
    });
  });
});
