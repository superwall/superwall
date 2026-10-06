import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostState } from "@superwall/host";
import { SurfaceCard } from "../../src/components/SurfaceCard";
import type { StudioStatus, StudioSurface } from "../../src/lib/surfaces";

const surface: StudioSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  routes: ["index"],
  locales: ["en"],
  products: {},
};

const hostState = createHostState({ paywallId: "1", paywallIdentifier: "plus" });

const card = (over: { surface?: StudioSurface; status?: StudioStatus; onOpen?: () => void } = {}) =>
  render(
    <SurfaceCard
      surface={over.surface ?? surface}
      status={over.status}
      previewSrc="/preview/paywall/plus-upgrade?transport=editor"
      hostState={hostState}
      onOpen={over.onOpen ?? (() => undefined)}
    />,
  );

const widthOf = (value: number) =>
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: value,
    height: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SurfaceCard", () => {
  it("scales the preview to the width it was given", () => {
    widthOf(195);

    const { container } = card();
    const frame = container.querySelector("iframe");

    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("width")).toBe("390");
    expect(frame?.style.transform).toBe("scale(0.5)");
    expect(frame?.getAttribute("title")).toBe("plus-upgrade preview");
  });

  it("renders no preview until it has been measured", () => {
    widthOf(0);

    const { container } = card();

    expect(container.querySelector("iframe")).toBeNull();
  });

  it("re-measures when the card is resized", () => {
    let observed: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observed = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const rect = widthOf(0);

    const { container } = card();
    expect(container.querySelector("iframe")).toBeNull();

    rect.mockReturnValue({
      width: 390,
      height: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    act(() => observed?.());

    expect(container.querySelector("iframe")?.style.transform).toBe("scale(1)");
  });

  it("still measures once where nothing reports resizes", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    widthOf(390);

    const { container } = card();

    expect(container.querySelector("iframe")?.style.transform).toBe("scale(1)");
  });

  it("names the project a surface belongs to, and the platforms it pushes to", () => {
    widthOf(0);

    const { container } = card({
      surface: { ...surface, project: "chatgpt", platforms: ["ios", "android"] },
    });

    expect(container.textContent).toContain("chatgpt · iOS · Android");
  });

  it("says when a surface was last edited, or that it has never been published", () => {
    widthOf(0);

    card({ status: { paywallId: "208540", active: true, updatedAt: new Date().toISOString() } });
    expect(screen.getByText(/^Edited /)).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();

    card({ status: { paywallId: "208540", active: false } });
    expect(screen.getByText("Not published")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
  });

  it("opens the surface in place, but lets a modified click open a tab", () => {
    widthOf(0);
    const onOpen = vi.fn();

    const { container } = card({ onOpen });
    const link = container.querySelector("a");

    expect(link?.getAttribute("href")).toBe("/paywall/plus-upgrade");
    fireEvent.click(link!);
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(link!, { metaKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
