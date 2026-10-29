import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Canvas,
  useCanvasScale,
  type CanvasHandle,
  type CanvasZoom,
} from "../../../src/components/preview/Canvas";

type Size = { width: number; height: number };

let clock = 0;

const nextGesture = () => {
  clock += 1000;
};

const sizes: Record<string, Size> = {};

const mockSizes = () => {
  const of = (element: HTMLElement) => sizes[element.getAttribute("data-testid") ?? ""];
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return of(this)?.width ?? 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return of(this)?.height ?? 0;
    },
  );
};

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

const Scale = () => <span data-testid="scale">{useCanvasScale()}</span>;

const setUp = (viewport: Size, content: Size) => {
  sizes.canvas = viewport;
  sizes["canvas-content"] = content;
  mockSizes();
  vi.stubGlobal("PointerEvent", TestPointerEvent);
};

const mount = (
  viewport: Size = { width: 1000, height: 800 },
  content: Size = { width: 2000, height: 1000 },
) => {
  setUp(viewport, content);
  const handle = React.createRef<CanvasHandle>();
  const zoom = { current: { scale: 1, fitted: true } as CanvasZoom };
  const tree = (fitKey: string) => (
    <Canvas fitKey={fitKey} ref={handle} onZoom={(next) => (zoom.current = next)}>
      <div>
        frame
        <Scale />
      </div>
    </Canvas>
  );
  const view = render(tree("a"));
  const canvas = screen.getByTestId("canvas");
  const layer = screen.getByTestId("canvas-content");
  const api = () => {
    if (!handle.current) throw new Error("canvas handle not attached");
    return handle.current;
  };
  return { view, tree, canvas, layer, api, zoom };
};

const mountWithFrame = () => {
  setUp({ width: 1000, height: 800 }, { width: 400, height: 800 });
  const view = render(
    <Canvas fitKey="a">
      <iframe title="paywall" src="about:blank" />
    </Canvas>,
  );
  const layer = screen.getByTestId("canvas-content");
  const frame = screen.getByTitle("paywall");
  if (!(frame instanceof HTMLIFrameElement)) throw new Error("paywall is not an iframe");
  const target = frame.contentWindow;
  if (!target) throw new Error("iframe without a window");
  return { view, layer, frame, target };
};

const transformOf = (layer: HTMLElement) => {
  const match = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(
    layer.style.transform,
  );
  if (!match) throw new Error(`unexpected transform ${layer.style.transform}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
};

beforeEach(() => {
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Canvas", () => {
  it("fits the content on mount and reports the zoom to its owner and children", () => {
    const { layer, zoom } = mount();
    expect(transformOf(layer).scale).toBeCloseTo(904 / 2000);
    expect(screen.getByTestId("scale").textContent).toBe(String(904 / 2000));
    expect(zoom.current).toEqual({ scale: 904 / 2000, fitted: true });
  });

  it("zooms around the cursor on a pinch or ctrl-wheel, and pans on a plain wheel", () => {
    const { canvas, layer, zoom } = mount();
    const before = transformOf(layer);

    fireEvent.wheel(canvas, { deltaY: -100, ctrlKey: true, clientX: 500, clientY: 400 });
    const zoomed = transformOf(layer);
    expect(zoomed.scale).toBeGreaterThan(before.scale);
    expect(zoom.current.fitted).toBe(false);

    fireEvent.wheel(canvas, { deltaX: 30, deltaY: 20 });
    const panned = transformOf(layer);
    expect(panned.x).toBeCloseTo(zoomed.x - 30);
    expect(panned.y).toBeCloseTo(zoomed.y - 20);
    expect(panned.scale).toBe(zoomed.scale);
  });

  it("pans on drag, steps through its handle, and fit snaps back", () => {
    const { canvas, layer, api, zoom } = mount();
    const fitted = transformOf(layer);

    canvas.setPointerCapture = () => {};
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 50, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    const dragged = transformOf(layer);
    expect(dragged.x).toBeCloseTo(fitted.x + 40);
    expect(dragged.y).toBeCloseTo(fitted.y + 20);

    act(() => api().zoomStep(1));
    expect(transformOf(layer).scale).toBe(0.57);
    act(() => api().hold());
    expect(zoom.current?.fitted).toBe(false);
    act(() => api().pan(10, -5));
    act(() => api().actualSize());
    expect(transformOf(layer)).toEqual({ scale: 1, x: -500, y: -100 });
    expect(zoom.current).toEqual({ scale: 1, fitted: false });

    act(() => api().fit());
    expect(transformOf(layer)).toEqual(fitted);
    expect(zoom.current.fitted).toBe(true);
  });

  it("zooms on a pinch over a same-origin paywall frame", () => {
    const { layer, target } = mountWithFrame();
    const before = transformOf(layer);

    const pinch = new WheelEvent("wheel", { deltaY: -40, ctrlKey: true, cancelable: true });
    act(() => {
      target.dispatchEvent(pinch);
    });
    expect(pinch.defaultPrevented).toBe(true);
    expect(transformOf(layer).scale).toBeGreaterThan(before.scale);
  });

  it("leaves a left-button drag inside a frame entirely to the paywall", () => {
    const { layer, target } = mountWithFrame();
    const before = transformOf(layer);
    const pointer = (type: string, init: PointerEventInit) =>
      new TestPointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        ...init,
      });
    act(() => {
      target.dispatchEvent(
        pointer("pointerdown", { pointerId: 1, button: 0, screenX: 100, screenY: 100 }),
      );
      target.dispatchEvent(pointer("pointermove", { pointerId: 1, screenX: 180, screenY: 160 }));
      target.dispatchEvent(pointer("pointerup", { pointerId: 1, button: 0 }));
    });
    expect(transformOf(layer)).toEqual(before);
    expect(screen.getByTestId("canvas").hasAttribute("data-dragging")).toBe(false);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
  });

  it("pans on a middle-button drag that starts over a frame, and swallows the click it would leave behind", () => {
    const { layer, target } = mountWithFrame();
    const before = transformOf(layer);
    const pointer = (type: string, init: PointerEventInit) =>
      new TestPointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        ...init,
      });

    act(() => {
      target.dispatchEvent(
        pointer("pointerdown", { pointerId: 1, button: 1, screenX: 100, screenY: 100 }),
      );
      target.dispatchEvent(pointer("pointermove", { pointerId: 1, screenX: 102, screenY: 101 }));
    });
    expect(transformOf(layer)).toEqual(before);

    act(() => {
      target.dispatchEvent(pointer("pointermove", { pointerId: 1, screenX: 130, screenY: 120 }));
    });
    expect(transformOf(layer).x).toBeCloseTo(before.x + 30);
    expect(transformOf(layer).y).toBeCloseTo(before.y + 20);
    expect(screen.getByTestId("canvas").hasAttribute("data-dragging")).toBe(true);
    const grabRule = () => target.document.querySelector("style[data-studio-grab]")?.textContent;
    expect(grabRule()).toContain("cursor: grabbing !important");

    act(() => {
      target.dispatchEvent(pointer("pointerup", { pointerId: 1, button: 1 }));
    });
    expect(screen.getByTestId("canvas").hasAttribute("data-dragging")).toBe(false);
    expect(grabRule()).toBeUndefined();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    const later = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(later);
    });
    expect(later.defaultPrevented).toBe(false);
  });

  it("leaves a touch drag inside a frame to the paywall, which scrolls with it", () => {
    const { layer, target } = mountWithFrame();
    const before = transformOf(layer);
    act(() => {
      target.dispatchEvent(
        new TestPointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 3,
          pointerType: "touch",
          screenX: 0,
          screenY: 0,
        }),
      );
      target.dispatchEvent(
        new TestPointerEvent("pointermove", {
          bubbles: true,
          pointerId: 3,
          pointerType: "touch",
          screenX: 0,
          screenY: 80,
        }),
      );
    });
    expect(transformOf(layer)).toEqual(before);
  });

  it("keeps listening after a frame navigates, when its window is replaced", () => {
    const { layer, frame, target } = mountWithFrame();
    const before = transformOf(layer);

    act(() => {
      frame.dispatchEvent(new Event("load"));
    });
    const wheel = new WheelEvent("wheel", { deltaY: 40, cancelable: true });
    act(() => {
      target.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(transformOf(layer).y).toBeCloseTo(before.y - 40);
  });

  it("unmounts after a preview becomes cross-origin without accessing its window", () => {
    const { view, target } = mountWithFrame();
    const remove = vi.spyOn(target, "removeEventListener").mockImplementation(() => {
      throw new DOMException("Cross-origin window", "SecurityError");
    });
    try {
      expect(() => view.unmount()).not.toThrow();
      expect(remove).not.toHaveBeenCalled();
    } finally {
      remove.mockRestore();
    }
  });

  it("handles a cross-origin load and repeated cleanup without accessing the old window", () => {
    const { view, frame, target } = mountWithFrame();
    const errors: ErrorEvent[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    const remove = vi.spyOn(target, "removeEventListener").mockImplementation(() => {
      throw new DOMException("Cross-origin window", "SecurityError");
    });
    vi.spyOn(frame, "contentDocument", "get").mockReturnValue(null);
    try {
      fireEvent.load(frame);
      fireEvent.load(frame);
      expect(errors).toEqual([]);
      expect(() => view.unmount()).not.toThrow();
      expect(remove).not.toHaveBeenCalled();
    } finally {
      remove.mockRestore();
      window.removeEventListener("error", onError);
    }
  });

  it("removes the pending drag click suppression when a frame reloads", () => {
    const { frame, target } = mountWithFrame();
    act(() => {
      target.dispatchEvent(new TestPointerEvent("pointerdown", { button: 1, screenX: 10 }));
      target.dispatchEvent(new TestPointerEvent("pointermove", { screenX: 40 }));
      target.dispatchEvent(new TestPointerEvent("pointerup", { button: 1 }));
    });
    fireEvent.load(frame);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    target.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it("leaves the wheel to a paywall that scrolls at all, even at its ends, and pans over one that cannot", () => {
    const { layer, frame, target } = mountWithFrame();
    const before = transformOf(layer);
    const body = frame.contentDocument?.body;
    if (!body) throw new Error("iframe without a body");
    const page = body.ownerDocument.createElement("div");
    page.style.overflowY = "auto";
    Object.defineProperty(page, "scrollHeight", { value: 2000 });
    Object.defineProperty(page, "clientHeight", { value: 800 });
    body.appendChild(page);
    const wheel = (node: EventTarget, init: WheelEventInit) => {
      nextGesture();
      const event = new WheelEvent("wheel", { cancelable: true, bubbles: true, ...init });
      act(() => {
        node.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };

    expect(wheel(page, { deltaY: 40 })).toBe(false);
    expect(wheel(page, { deltaY: -40 })).toBe(false);
    page.scrollTop = 1200;
    expect(wheel(page, { deltaY: 40 })).toBe(false);
    expect(transformOf(layer)).toEqual(before);

    expect(wheel(page, { deltaX: 25 })).toBe(true);
    expect(transformOf(layer).x).toBeCloseTo(before.x - 25);

    expect(wheel(target, { deltaY: 40 })).toBe(true);
    expect(transformOf(layer).y).toBeCloseTo(before.y - 40);
  });

  it("never pans when the paywall claims the wheel: a handler, hidden overflow, or overscroll containment", () => {
    const { layer, frame, target } = mountWithFrame();
    const before = transformOf(layer);
    const doc = frame.contentDocument;
    if (!doc) throw new Error("iframe without a document");
    const wheel = (node: EventTarget, init: WheelEventInit) => {
      nextGesture();
      const event = new WheelEvent("wheel", { cancelable: true, bubbles: true, ...init });
      act(() => {
        node.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };

    const picker = doc.createElement("div");
    picker.addEventListener("wheel", (event) => event.preventDefault());
    doc.body.appendChild(picker);
    wheel(picker, { deltaY: 40 });
    expect(transformOf(layer)).toEqual(before);

    const custom = doc.createElement("div");
    custom.style.overflowY = "hidden";
    Object.defineProperty(custom, "scrollHeight", { value: 1500 });
    Object.defineProperty(custom, "clientHeight", { value: 500 });
    doc.body.appendChild(custom);
    expect(wheel(custom, { deltaY: 40 })).toBe(false);
    expect(transformOf(layer)).toEqual(before);

    const contained = doc.createElement("div");
    contained.style.overscrollBehaviorY = "contain";
    const leaf = doc.createElement("span");
    contained.appendChild(leaf);
    doc.body.appendChild(contained);
    expect(wheel(leaf, { deltaY: 40 })).toBe(false);
    expect(transformOf(layer)).toEqual(before);

    expect(wheel(target, { deltaY: 40 })).toBe(true);
    expect(transformOf(layer).y).toBeCloseTo(before.y - 40);
  });

  it("judges scrollability on the dominant axis of a diagonal wheel", () => {
    const { layer, frame } = mountWithFrame();
    const before = transformOf(layer);
    const body = frame.contentDocument?.body;
    if (!body) throw new Error("iframe without a body");
    const page = body.ownerDocument.createElement("div");
    page.style.overflowY = "auto";
    Object.defineProperty(page, "scrollHeight", { value: 1000 });
    Object.defineProperty(page, "clientHeight", { value: 800 });
    body.appendChild(page);

    const mostlyDown = new WheelEvent("wheel", {
      deltaX: 3,
      deltaY: 40,
      cancelable: true,
      bubbles: true,
    });
    act(() => {
      page.dispatchEvent(mostlyDown);
    });
    expect(mostlyDown.defaultPrevented).toBe(false);
    expect(transformOf(layer)).toEqual(before);
  });

  it("shows a hand while Space is held and a grabbing hand while dragging, keeping frames inert", () => {
    const { canvas } = mount();
    expect(canvas.hasAttribute("data-panning")).toBe(false);
    expect(canvas.className).not.toContain("cursor-");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    });
    expect(canvas.hasAttribute("data-panning")).toBe(true);
    expect(canvas.className).toContain("cursor-grab ");
    expect(canvas.className).toContain("pointer-events-none");

    canvas.setPointerCapture = () => {};
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    expect(canvas.hasAttribute("data-dragging")).toBe(true);
    expect(canvas.className).toContain("cursor-grabbing");
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(canvas.hasAttribute("data-dragging")).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    });
    expect(canvas.hasAttribute("data-panning")).toBe(false);
    expect(canvas.className).not.toContain("pointer-events-none");
  });

  it("pans on a middle-button drag as well", () => {
    const { canvas, layer } = mount();
    const before = transformOf(layer);
    canvas.setPointerCapture = () => {};
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 0, clientY: 0, button: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: -30, clientY: 15 });
    fireEvent.pointerUp(canvas, { pointerId: 2 });
    expect(transformOf(layer).x).toBeCloseTo(before.x - 30);
    expect(transformOf(layer).y).toBeCloseTo(before.y + 15);
  });

  it("answers the keyboard, except while typing, and refits when the content changes shape", () => {
    const { view, tree, layer, api } = mount();
    const fitted = transformOf(layer);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", metaKey: true }));
    });
    expect(transformOf(layer).scale).toBe(0.57);

    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "0", metaKey: true, bubbles: true }));
    });
    expect(transformOf(layer).scale).toBe(0.57);
    input.remove();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", metaKey: true }));
    });
    expect(transformOf(layer)).toEqual(fitted);

    act(() => api().zoomStep(1));
    view.rerender(tree("b"));
    expect(transformOf(layer)).toEqual(fitted);
  });
});
