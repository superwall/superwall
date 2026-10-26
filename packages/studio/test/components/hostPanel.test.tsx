import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HostPanel,
  clampHostPanelWidth,
  hostPanelMax,
} from "../../src/components/panels/SidePanel";

const KEY = "sw-studio-panel-width";

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

const rowWidth = (value: number) =>
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(value);

const mount = (props: Partial<React.ComponentProps<typeof HostPanel>> = {}) => {
  const view = render(
    <div>
      <HostPanel open label="Chat" {...props}>
        <p>slot</p>
      </HostPanel>
    </div>,
  );
  const panel = screen.getByTestId("host-panel");
  const handle = screen.getByRole("separator", { name: "Resize chat" });
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 100, y: 0, width: 368, height: 800 }),
  );
  const width = () => panel.style.getPropertyValue("--sw-host-panel");
  return { view, panel, handle, width };
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("clampHostPanelWidth", () => {
  it("keeps the panel at its minimum and the stage beside it", () => {
    expect(clampHostPanelWidth(100, 1600)).toBe(320);
    expect(clampHostPanelWidth(500.4, 1600)).toBe(500);
    // 60% of the row.
    expect(clampHostPanelWidth(1400, 1600)).toBe(960);
    // The stage keeps 400px.
    expect(clampHostPanelWidth(1400, 900)).toBe(500);
    // And whatever else its row holds.
    expect(clampHostPanelWidth(1400, 1200, 320)).toBe(480);
  });

  it("never goes below the minimum, and has no maximum before the row is measured", () => {
    expect(clampHostPanelWidth(600, 500)).toBe(320);
    expect(hostPanelMax(0)).toBe(Number.POSITIVE_INFINITY);
    expect(clampHostPanelWidth(2000, 0)).toBe(2000);
  });
});

describe("HostPanel", () => {
  it("opens at the default width, clamped in CSS to the row", () => {
    const { handle, width } = mount();
    expect(width()).toBe("clamp(320px, 368px, max(320px, min(60cqw, 100cqw - 400px)))");
    expect(screen.getByText("slot")).toBeTruthy();
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuemin")).toBe("320");
    expect(handle.getAttribute("aria-valuenow")).toBe("368");
    expect(handle.tabIndex).toBe(0);
  });

  it("has no handle while closed", () => {
    render(
      <HostPanel open={false} label="Chat">
        <p>slot</p>
      </HostPanel>,
    );
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.getByTestId("host-panel").className).toContain("w-0");
  });

  it("follows the pointer without its open transition, and remembers the width", () => {
    rowWidth(1600);
    const { panel, handle, width } = mount();
    expect(handle.getAttribute("aria-valuemax")).toBe("960");
    fireEvent.pointerMove(handle, { clientX: 700 });
    expect(width()).toContain(" 368px,");

    fireEvent.pointerDown(handle, { pointerId: 1, button: 2 });
    expect(handle.setPointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 468 });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    expect(panel.className).not.toContain("transition-[width]");
    expect(handle.dataset.dragging).toBe("true");
    fireEvent.pointerMove(handle, { clientX: 600 });
    expect(width()).toContain(" 500px,");
    // Past the maximum it holds the maximum.
    fireEvent.pointerMove(handle, { clientX: 1500 });
    expect(handle.getAttribute("aria-valuenow")).toBe("960");
    fireEvent.pointerMove(handle, { clientX: 600 });

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(panel.className).toContain("transition-[width]");
    expect(window.localStorage.getItem(KEY)).toBe("500");

    fireEvent.pointerMove(handle, { clientX: 800 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(width()).toContain(" 500px,");
  });

  it("stops dragging when the pointer is cancelled or capture is lost", () => {
    rowWidth(1600);
    const { handle, width } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
    fireEvent.pointerCancel(handle);
    fireEvent.pointerMove(handle, { clientX: 700 });
    expect(width()).toContain(" 368px,");

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
    fireEvent.lostPointerCapture(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 700 });
    expect(width()).toContain(" 368px,");
  });

  it("ignores a drag position it cannot measure", () => {
    const { handle, width } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
    fireEvent(handle, new Event("pointermove", { bubbles: true }));
    expect(width()).toContain(" 368px,");
  });

  it("steps with the arrow keys, goes to the ends with Home and End, and ignores other keys", () => {
    rowWidth(1600);
    const { handle, width } = mount();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(width()).toContain(" 384px,");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle.getAttribute("aria-valuenow")).toBe("352");
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe("960");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe("320");
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle.getAttribute("aria-valuenow")).toBe("320");
    expect(window.localStorage.getItem(KEY)).toBe("320");
  });

  it("does nothing on End before the row is measured", () => {
    const { handle } = mount();
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe("368");
    expect(handle.hasAttribute("aria-valuemax")).toBe(false);
  });

  it("restores a remembered width, and ignores one that is not a number", () => {
    window.localStorage.setItem(KEY, "420");
    const first = mount();
    expect(first.width()).toContain(" 420px,");
    first.view.unmount();

    window.localStorage.setItem(KEY, "wide");
    expect(mount().width()).toContain(" 368px,");
  });

  it("goes back to the default width on double click", () => {
    window.localStorage.setItem(KEY, "420");
    const { handle, width } = mount();
    fireEvent.doubleClick(handle);
    expect(width()).toContain(" 368px,");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("leaves the width to a host that owns it", () => {
    window.localStorage.setItem(KEY, "420");
    rowWidth(1600);
    const onWidthChange = vi.fn();
    const { handle, width, view } = mount({ width: 600, onWidthChange });
    expect(width()).toContain(" 600px,");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onWidthChange).toHaveBeenLastCalledWith(584);
    expect(width()).toContain(" 600px,");
    fireEvent.doubleClick(handle);
    expect(onWidthChange).toHaveBeenLastCalledWith(undefined);
    expect(window.localStorage.getItem(KEY)).toBe("420");

    view.rerender(
      <div>
        <HostPanel open label="Chat" onWidthChange={onWidthChange}>
          <p>slot</p>
        </HostPanel>
      </div>,
    );
    expect(width()).toContain(" 368px,");
  });

  it("keeps working when storage is unavailable", () => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    rowWidth(1600);
    const { handle, width } = mount();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(width()).toContain(" 384px,");
    fireEvent.doubleClick(handle);
    expect(width()).toContain(" 368px,");
  });
});
