import { afterEach, describe, expect, it, vi } from "vitest";
import { createTeleportScreen, poweredByHref } from "../../../src/checkout/teleport/screen";

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
  document.querySelectorAll(".sw-teleport").forEach((node) => node.remove());
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
});
