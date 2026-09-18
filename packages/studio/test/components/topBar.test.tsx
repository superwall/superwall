import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { titleFits, TopBar } from "../../src/components/chrome/TopBar";
import { StudioHostProvider, type StudioMode } from "../../src/lib/studio-host";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = (home: { href: string; navigate: () => void }, mode: StudioMode = "local") =>
  render(
    <StudioHostProvider mode={mode} home={home}>
      <TopBar title="pro" />
    </StudioHostProvider>,
  );

const logo = () => screen.getByRole("link");

describe("the studio's home link", () => {
  it("handles a plain click itself, without leaving the page", () => {
    const navigate = vi.fn();
    mount({ href: "/", navigate });

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    logo().dispatchEvent(event);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("points at the host's home, so the browser opens the right page in a new tab", () => {
    // The dashboard's studio lives under /:org/:app/paywalls/:id/studio, where
    // the origin root is not the list the logo goes back to.
    mount({ href: "/3642/52516/paywalls", navigate: () => {} }, "hosted");

    expect(logo().getAttribute("href")).toBe("/3642/52516/paywalls");
  });

  it("follows the device studio home, not the desktop one", () => {
    mount({ href: "/device", navigate: () => {} }, "device");

    expect(logo().getAttribute("href")).toBe("/device");
  });

  for (const [name, init] of [
    ["a middle click", { button: 1 }],
    ["cmd-click", { button: 0, metaKey: true }],
    ["ctrl-click", { button: 0, ctrlKey: true }],
    ["shift-click", { button: 0, shiftKey: true }],
  ] as const) {
    it(`leaves ${name} to the browser`, () => {
      const navigate = vi.fn();
      mount({ href: "/paywalls", navigate });

      // Read the flag once the bar's handler has had it, then stop the event:
      // an un-prevented click on a real href sends jsdom off navigating, which
      // it cannot do and reports asynchronously, after the test has finished.
      let prevented: boolean | undefined;
      document.addEventListener(
        "click",
        (event) => {
          prevented = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true },
      );
      logo().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));

      expect(navigate).not.toHaveBeenCalled();
      expect(prevented).toBe(false);
    });
  }

  it("refuses to render outside a host, rather than guessing at a home", () => {
    expect(() => render(<TopBar title="pro" />)).toThrow(/StudioHostProvider/);
  });
});

type Box = { left: number; width: number };

const boxes = new WeakMap<HTMLElement, Box>();

let barWidth = 1200;

const mockLayout = () => {
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(
    function (this: HTMLElement) {
      return boxes.get(this)?.left ?? 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return boxes.get(this)?.width ?? 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return boxes.get(this)?.width ?? 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-bar") ? barWidth : 0;
    },
  );
};

const mountTitled = (title: string) => {
  mockLayout();
  render(
    <StudioHostProvider mode="local" home={{ href: "/", navigate: () => {} }}>
      <TopBar title={title} actions={<button type="button">Push</button>} />
    </StudioHostProvider>,
  );
  const titleElement = screen.getByText(title);
  const bar = titleElement.parentElement as HTMLElement;
  bar.setAttribute("data-bar", "");
  const [left, , right] = [...bar.children] as HTMLElement[];
  return { bar, titleElement, left, right };
};

const layOut = (
  parts: { bar: HTMLElement; titleElement: HTMLElement; left: HTMLElement; right: HTMLElement },
  width: number,
  titleWidth: number,
) => {
  barWidth = width;
  boxes.set(parts.left, { left: 12, width: 160 });
  boxes.set(parts.right, { left: width - 12 - 220, width: 220 });
  boxes.set(parts.titleElement, { left: width / 2 - titleWidth / 2, width: titleWidth });
};

describe("the centred title", () => {
  it("shows while it clears both the wordmark and the actions", () => {
    const parts = mountTitled("superwall-web / zero");
    layOut(parts, 1200, 160);
    expect(titleFits(parts.bar, parts.titleElement)).toBe(true);
  });

  it("hides as soon as its own length would collide with either side, not at a breakpoint", () => {
    const parts = mountTitled("superwall-web / zero");
    layOut(parts, 700, 160);
    expect(titleFits(parts.bar, parts.titleElement)).toBe(true);

    layOut(parts, 700, 260);
    expect(titleFits(parts.bar, parts.titleElement)).toBe(false);

    layOut(parts, 560, 160);
    expect(titleFits(parts.bar, parts.titleElement)).toBe(false);
  });

  it("re-measures on resize and takes the hidden title out of the accessibility tree", async () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const parts = mountTitled("superwall-web / zero");
    layOut(parts, 560, 160);
    await act(async () => {
      for (const callback of observers) callback([], {} as ResizeObserver);
    });
    expect(parts.titleElement.className).toContain("invisible");
    expect(parts.titleElement.getAttribute("aria-hidden")).toBe("true");

    layOut(parts, 1200, 160);
    await act(async () => {
      for (const callback of observers) callback([], {} as ResizeObserver);
    });
    expect(parts.titleElement.className).not.toContain("invisible");
  });
});
