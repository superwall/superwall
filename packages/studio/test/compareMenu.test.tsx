import { fireEvent, render, screen, within } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { CompareMenu, type CompareOption } from "../src/components/CompareMenu";
import type { StudioSurface } from "../src/lib/types";

const surface = (id: string): StudioSurface => ({
  kind: "paywall",
  id,
  routes: ["index"],
  locales: [],
});

const options = (count: number): CompareOption[] => [
  { key: "live", label: "Live version", hint: "What SDKs receive today", target: { type: "live" } },
  ...Array.from({ length: count }, (_, index) => {
    const id = `paywall-${index}`;
    return {
      key: `surface:paywall/${id}`,
      label: `paywall/${id}`,
      hint: "Local preview",
      target: { type: "surface", surface: surface(id) } as const,
    };
  }),
];

const open = (props: Partial<React.ComponentProps<typeof CompareMenu>> = {}) => {
  const onSelect = vi.fn();
  render(<CompareMenu active={undefined} options={options(3)} onSelect={onSelect} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
  return onSelect;
};

describe("CompareMenu", () => {
  it("pins live and off below the paywalls, so they never scroll away", () => {
    open({ options: options(200) });

    const groups = document.querySelectorAll(".bg-bar > div");
    const pinned = within(groups[groups.length - 1] as HTMLElement);
    expect(pinned.getByText("Live version")).toBeDefined();
    expect(pinned.getByText("Off")).toBeDefined();
    expect(pinned.queryByText("paywall/paywall-0")).toBeNull();

    // the search sits above everything, and only the paywalls scroll
    const order = [...document.querySelectorAll(".bg-bar > div")].map((el) =>
      el.querySelector("input")
        ? "search"
        : el.className.includes("overflow-y-auto")
          ? "paywalls"
          : "pinned",
    );
    expect(order).toEqual(["search", "paywalls", "pinned"]);
    expect(document.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
  });

  it("filters the paywalls by search, leaving off and live reachable", () => {
    open();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search paywalls" }), {
      target: { value: "paywall-2" },
    });

    expect(screen.getByText("paywall/paywall-2")).toBeDefined();
    expect(screen.queryByText("paywall/paywall-0")).toBeNull();
    expect(screen.getByText("Off")).toBeDefined();
    expect(screen.getByText("Live version")).toBeDefined();
  });

  it("says so when a search matches nothing, rather than showing an empty menu", () => {
    open();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search paywalls" }), {
      target: { value: "nope" },
    });

    expect(screen.getByText(/Nothing matches/)).toBeDefined();
  });

  it("scrolls the paywalls instead of growing without limit", () => {
    open({ options: options(200) });

    const list = document.querySelector(".overflow-y-auto");
    expect(list?.className).toContain("max-h-64");
    expect(list?.querySelectorAll("button")).toHaveLength(200);
  });

  it("marks what is being compared beside its name, and switching back off is one click", () => {
    const onSelect = open({ active: { type: "live" } });

    const liveRow = screen.getByText("Live version").closest("button") as HTMLElement;
    expect(liveRow.getAttribute("aria-current")).toBe("true");
    // the dot rides on the title row, not in a column of its own
    expect(
      screen.getByText("Live version").parentElement?.querySelector(".bg-accent"),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Off"));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it("forgets the search when reopened, so the list is never mysteriously short", () => {
    open();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search paywalls" }), {
      target: { value: "paywall-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));

    expect(
      (screen.getByRole("searchbox", { name: "Search paywalls" }) as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByText("paywall/paywall-0")).toBeDefined();
  });
});
