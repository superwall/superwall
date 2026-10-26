import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  balanceRows,
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
  const toolbar = view.container.firstElementChild?.firstElementChild as HTMLElement;
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

describe("balanceRows", () => {
  // Greedy wrap of fixed-width items into the toolbar's max-width, the way flex-wrap lays them out.
  const wrapping = (widths: number[], full: number) => {
    const toolbar = document.createElement("div");
    toolbar.style.flexWrap = "wrap";
    const items = widths.map((width) => {
      const item = document.createElement("span");
      item.dataset.width = String(width);
      toolbar.append(item);
      return item;
    });
    const tops = () => {
      const limit = Number.parseFloat(toolbar.style.maxWidth) || full;
      const result = new Map<HTMLElement, number>();
      let row = 0;
      let used = 0;
      for (const item of items) {
        const width = Number(item.dataset.width);
        if (used > 0 && used + width > limit) {
          row += 1;
          used = 0;
        }
        used += width;
        result.set(item, row * ROW);
      }
      return result;
    };
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        return tops().get(this) ?? 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this === toolbar ? Number.parseFloat(toolbar.style.maxWidth) || full : 0;
      },
    );
    const rows = () => new Set(tops().values()).size;
    const perRow = () => {
      const counts = new Map<number, number>();
      for (const top of tops().values()) counts.set(top, (counts.get(top) ?? 0) + 1);
      return [...counts.values()];
    };
    return { toolbar, rows, perRow };
  };

  it("spreads the items over the rows they need instead of stranding the last one", () => {
    const { toolbar, rows, perRow } = wrapping([100, 100, 100, 100], 320);
    expect(perRow()).toEqual([3, 1]);
    balanceRows(toolbar);
    expect(rows()).toBe(2);
    expect(perRow()).toEqual([2, 2]);
  });

  it("leaves a single row alone", () => {
    const { toolbar } = wrapping([100, 100], 400);
    balanceRows(toolbar);
    expect(toolbar.style.maxWidth).toBe("");
  });

  it("leaves a toolbar that scrolls instead of wrapping alone", () => {
    const { toolbar } = wrapping([100, 100, 100, 100], 320);
    toolbar.style.flexWrap = "nowrap";
    balanceRows(toolbar);
    expect(toolbar.style.maxWidth).toBe("");
  });
});
