import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReturnDim,
  arrowPaths,
  arrowTailX,
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
    dim.showHint("Tap to go back to the app", "rtl");
    dim.showHint("Again", "ltr");
    const hints = dim.root.querySelectorAll<HTMLElement>(".sw-teleport-dim-hint");
    expect(hints).toHaveLength(1);
    expect(hints[0]?.dir).toBe("rtl");
    expect(hints[0]?.querySelector(".sw-teleport-dim-caption")?.textContent).toBe(
      "Tap to go back to the app",
    );

    expect(hints[0]?.dataset.side).toBe("ltr");
    const arrow = hints[0]?.querySelectorAll(".sw-teleport-dim-arrow path");
    expect(arrow).toHaveLength(2);
    expect(arrow?.[0]?.getAttribute("d")).toMatch(new RegExp(`L${window.innerWidth - 61.5} [\\d.]+$`));

    const leaving = createReturnDim();
    leaving.remove();
    leaving.showHint("Late", "ltr");
    expect(leaving.root.querySelector(".sw-teleport-dim-hint")).toBeNull();
  });

  it.each([
    [
      "iOS 27.2, page under the bars",
      { userAgent: safari("27.2"), innerWidth: 402, innerHeight: 874, screenHeight: 874 },
      340.5,
      457.7,
    ],
    [
      "iOS 26.5, page under the bars",
      { userAgent: safari("26.5"), innerWidth: 440, innerHeight: 956, screenHeight: 956 },
      378.5,
      498.7,
    ],
    [
      "iOS 26.5, page between the bars",
      { userAgent: safari("26.5"), innerWidth: 402, innerHeight: 714, screenHeight: 874 },
      340.5,
      395.7,
    ],
    [
      "iOS 18.6",
      { userAgent: safari("18.6"), innerWidth: 402, innerHeight: 678, screenHeight: 874 },
      340.5,
      377.5,
    ],
    [
      "iOS 18.6 on a 375 pt screen",
      { userAgent: safari("18.6"), innerWidth: 375, innerHeight: 547, screenHeight: 667 },
      313.5,
      312,
    ],
    [
      "iOS 17.5 on a 375 pt screen",
      { userAgent: safari("17.5"), innerWidth: 375, innerHeight: 547, screenHeight: 667 },
      313.5,
      308.8,
    ],
    [
      "a browser that isn't Safari",
      { userAgent: "CriOS/140", innerWidth: 402, innerHeight: 874, screenHeight: 874 },
      340.5,
      457.7,
    ],
  ])("puts Open's bottom centre where %s draws it", (_, view, x, y) => {
    const anchor = openButtonAnchor({ language: "en-US", ...view });
    expect(anchor.x).toBeCloseTo(x, 1);
    expect(anchor.y).toBeCloseTo(y, 1);
    expect(anchor.side).toBe("ltr");
  });

  it("leaves the same gap from the alert to the arrow as from the arrow to the caption's capitals", () => {
    const layout = hintLayout({ x: 340.5, y: 457.7 });
    const alertBottom = 457.7 + 10;
    const arrowTop = layout.tipY - 1.5;
    const arrowBottom = layout.tailY + 1.5;
    const capitalsTop = layout.captionTop + 5;
    expect(arrowTop - alertBottom).toBeCloseTo(14, 5);
    expect(capitalsTop - arrowBottom).toBeCloseTo(14, 5);
    expect(layout.tipX).toBe(340.5);
  });

  it("starts the arrow inside the caption's first line, toward Open's side", () => {
    expect(arrowTailX(340.5, "ltr", { left: 100, right: 300 })).toBe(284);
    expect(arrowTailX(340.5, "ltr", { left: 20, right: 380 })).toBe(284.5);
    expect(arrowTailX(340.5, "ltr", { left: 150, right: 250 })).toBe(234);
    expect(arrowTailX(61.5, "rtl", { left: 150, right: 250 })).toBe(166);
    expect(arrowTailX(61.5, "rtl", { left: 100, right: 300 })).toBe(117.5);
    expect(arrowTailX(340.5, "ltr", undefined)).toBe(284.5);
    expect(arrowTailX(340.5, "ltr", { left: 200, right: 210 })).toBe(284.5);
  });

  it("draws the arrow as one straight line from the caption to Open, its head turned along it", () => {
    const layout = { tipX: 340.5, tipY: 483.2, tailY: 539.2, captionTop: 548.7 };
    const [line, head] = arrowPaths(284.5, layout);
    expect(line).toBe("M284.5 539.2L340.5 483.2");
    expect(head).toBe("M340.5 493.2L340.5 483.2L330.5 483.2");
    const [straight, straightHead] = arrowPaths(340.5, layout);
    expect(straight).toBe("M340.5 539.2L340.5 483.2");
    expect(straightHead).toBe("M347.6 490.3L340.5 483.2L333.4 490.3");
  });

  it("puts Open on the left when the phone, not the paywall, reads right to left", () => {
    const view = {
      userAgent: safari("27.2"),
      innerWidth: 402,
      innerHeight: 874,
      screenHeight: 874,
    };
    expect(openButtonAnchor({ ...view, language: "ar" })).toMatchObject({ x: 61.5, side: "rtl" });
    expect(openButtonAnchor({ ...view, language: "he-IL" }).side).toBe("rtl");
    expect(openButtonAnchor({ ...view, language: "de-DE" })).toMatchObject({
      x: 340.5,
      side: "ltr",
    });
  });
});
