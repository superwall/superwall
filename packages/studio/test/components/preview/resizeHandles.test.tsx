import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ResizeHandles } from "../../../src/components/preview/ResizeHandles";

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

beforeAll(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});

const clamp = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(3000, Math.max(200, value)) : fallback;

const size = { width: 393, height: 852 };

const mount = (scale = 1) => {
  const onResize = vi.fn();
  const onDragStart = vi.fn();
  const onShift = vi.fn();
  render(
    <ResizeHandles
      size={size}
      scale={scale}
      clamp={clamp}
      onResize={onResize}
      onDragStart={onDragStart}
      onShift={onShift}
    />,
  );
  return { onResize, onDragStart, onShift };
};

const handle = (id: string) => {
  const element = screen.getByTestId(id);
  element.setPointerCapture = () => {};
  return element;
};

const down = (element: HTMLElement, pointerId: number, x = 0, y = 0, init: PointerEventInit = {}) =>
  fireEvent.pointerDown(element, { pointerId, clientX: x, clientY: y, button: 0, buttons: 1, ...init });

const move = (element: HTMLElement, pointerId: number, x: number, y: number, buttons = 1) =>
  fireEvent.pointerMove(element, { pointerId, clientX: x, clientY: y, buttons });

describe("ResizeHandles", () => {
  it("drags the right edge to change only the width, in canvas units, and freezes the canvas first", () => {
    const { onResize, onDragStart, onShift } = mount(0.5);
    const right = handle("resize-right");
    down(right, 1, 100, 100);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    move(right, 1, 150, 300);
    expect(onResize).toHaveBeenLastCalledWith({ width: 493, height: 852 });
    expect(onShift).not.toHaveBeenCalled();
    fireEvent.pointerUp(right, { pointerId: 1 });
    move(right, 1, 400, 300);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("drags the bottom edge for height and the bottom-right corner for both, clamped", () => {
    const { onResize } = mount();
    const bottom = handle("resize-bottom");
    down(bottom, 2);
    move(bottom, 2, 80, -700);
    expect(onResize).toHaveBeenLastCalledWith({ width: 393, height: 200 });
    fireEvent.pointerCancel(bottom, { pointerId: 2 });

    const corner = handle("resize-bottom-right");
    down(corner, 3);
    move(corner, 3, 10, 20);
    expect(onResize).toHaveBeenLastCalledWith({ width: 403, height: 872 });
  });

  it("drags the left and top edges by growing the other way and shifting the canvas to keep the far edge put", () => {
    const { onResize, onShift } = mount(0.5);
    const left = handle("resize-left");
    down(left, 4, 200, 200);
    move(left, 4, 180, 200);
    expect(onResize).toHaveBeenLastCalledWith({ width: 433, height: 852 });
    expect(onShift).toHaveBeenLastCalledWith(-20, 0);
    move(left, 4, 170, 200);
    expect(onResize).toHaveBeenLastCalledWith({ width: 453, height: 852 });
    expect(onShift).toHaveBeenLastCalledWith(-10, 0);
    fireEvent.pointerUp(left, { pointerId: 4 });

    const corner = handle("resize-top-left");
    down(corner, 5, 0, 0);
    move(corner, 5, 10, -10);
    expect(onResize).toHaveBeenLastCalledWith({ width: 373, height: 872 });
    expect(onShift).toHaveBeenLastCalledWith(10, -10);
  });

  it("stops shifting once the size is clamped, so the far edge never drifts", () => {
    const { onResize, onShift } = mount();
    const top = handle("resize-top");
    down(top, 6, 0, 0);
    move(top, 6, 0, 700);
    expect(onResize).toHaveBeenLastCalledWith({ width: 393, height: 200 });
    expect(onShift).toHaveBeenLastCalledWith(0, 652);
    move(top, 6, 0, 800);
    expect(onResize).toHaveBeenLastCalledWith({ width: 393, height: 200 });
    expect(onShift).toHaveBeenCalledTimes(1);
  });

  it("ends a drag when the mouse is released anywhere, when capture is lost, or when no button is held", () => {
    const { onResize } = mount();
    const right = handle("resize-right");
    down(right, 7);
    move(right, 7, 10, 0);
    fireEvent.pointerUp(window, { pointerId: 7 });
    move(right, 7, 50, 0);
    expect(onResize).toHaveBeenCalledTimes(1);

    down(right, 8);
    fireEvent(right, new Event("lostpointercapture"));
    move(right, 8, 50, 0);
    expect(onResize).toHaveBeenCalledTimes(1);

    down(right, 9);
    move(right, 9, 50, 0, 0);
    expect(onResize).toHaveBeenCalledTimes(1);
    move(right, 9, 60, 0);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("ignores secondary mouse buttons, foreign pointers, and a capture the browser refuses", () => {
    const { onResize } = mount();
    const right = handle("resize-right");
    down(right, 1, 0, 0, { button: 2, pointerType: "mouse" });
    move(right, 1, 50, 0);
    down(right, 1);
    move(right, 9, 50, 0);
    fireEvent.pointerUp(right, { pointerId: 9 });
    move(right, 1, 50, 0);
    expect(onResize).toHaveBeenCalledTimes(1);

    const bottom = screen.getByTestId("resize-bottom");
    bottom.setPointerCapture = () => {
      throw new Error("no capture");
    };
    down(bottom, 4);
    move(bottom, 4, 0, 50);
    expect(onResize).toHaveBeenCalledTimes(1);
  });
});
