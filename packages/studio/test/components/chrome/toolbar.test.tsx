import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  markOrphanDividers,
  Toolbar,
  ToolbarDivider,
} from "../../../src/components/chrome/Toolbar";

type Box = { top: number; height: number };

const boxes = new WeakMap<HTMLElement, Box>();

const ROW = 40;

const layOut = (toolbar: HTMLElement, rowOf: (index: number) => number, heights?: number[]) => {
  [...toolbar.children].forEach((child, index) => {
    const height = heights?.[index] ?? 24;
    boxes.set(child as HTMLElement, { top: rowOf(index) * ROW + (ROW - height) / 2, height });
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

const mount = () => {
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
    function (this: HTMLElement) {
      return boxes.get(this)?.top ?? 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return boxes.get(this)?.height ?? 0;
    },
  );
  const view = render(
    <Toolbar>
      <span>a</span>
      <ToolbarDivider />
      <span>b</span>
      <ToolbarDivider />
      <span>c</span>
    </Toolbar>,
  );
  const toolbar = view.container.firstElementChild as HTMLElement;
  const dividers = () =>
    [...toolbar.querySelectorAll("[data-toolbar-divider]")].map((divider) =>
      divider.hasAttribute("data-orphan"),
    );
  return { toolbar, dividers };
};

describe("Toolbar dividers", () => {
  it("stay visible while everything sits on one row", () => {
    const { toolbar, dividers } = mount();
    layOut(toolbar, () => 0);
    markOrphanDividers(toolbar);
    expect(dividers()).toEqual([false, false]);
  });

  it("treat items of different heights, centred on one row, as that one row", () => {
    const { toolbar, dividers } = mount();
    layOut(toolbar, () => 0, [20, 24, 32, 24, 26]);
    markOrphanDividers(toolbar);
    expect(dividers()).toEqual([false, false]);
  });

  it("hide a divider that wraps to the end of a row, and one that starts the next", () => {
    const { toolbar, dividers } = mount();
    layOut(toolbar, (index) => (index <= 1 ? 0 : 1));
    markOrphanDividers(toolbar);
    expect(dividers()).toEqual([true, false]);

    layOut(toolbar, (index) => (index <= 2 ? 0 : 1));
    markOrphanDividers(toolbar);
    expect(dividers()).toEqual([false, true]);
  });

  it("comes back once the row is wide enough again", () => {
    const { toolbar, dividers } = mount();
    layOut(toolbar, (index) => (index <= 1 ? 0 : 1));
    markOrphanDividers(toolbar);
    layOut(toolbar, () => 0);
    markOrphanDividers(toolbar);
    expect(dividers()).toEqual([false, false]);
  });
});
