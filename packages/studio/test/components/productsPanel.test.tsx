import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductsPanel } from "../../src/components/panels/ProductsPanel";
import { productVariables } from "../../src/lib/products";

const annual = productVariables({
  identifier: "pro_5999_year",
  price: { amount: 5999, currency: "USD" },
  subscription: { period: "year", period_count: 1, trial_period_days: 7 },
});

const products = { annual: "pro_5999_year", weekly: "pro_499_week" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProductsPanel", () => {
  it("lists every slot in config order with what it sells", () => {
    render(
      <ProductsPanel
        products={products}
        samples={{
          products: {
            pro_5999_year: annual,
            pro_499_week: productVariables({
              identifier: "pro_499_week",
              price: { amount: 499, currency: "USD" },
              subscription: { period: "week" },
            }),
          },
        }}
      />,
    );

    const slots = screen.getAllByRole("region");
    expect(slots.map((slot) => slot.getAttribute("aria-label"))).toEqual(["annual", "weekly"]);

    const first = within(slots[0]!);
    expect(first.getByText("pro_5999_year")).toBeTruthy();
    expect(first.getByText("$59.99 / year")).toBeTruthy();
    expect(first.getByText("$5.00 / month · $1.15 / week")).toBeTruthy();
    expect(first.getByText("7-day free trial")).toBeTruthy();

    const second = within(slots[1]!);
    expect(second.getByText("$4.99 / week")).toBeTruthy();
    expect(second.queryByText(/free trial/)).toBeNull();
    expect(screen.getByText(/Push and promote to ship the change/)).toBeTruthy();
  });

  it("flags a slot whose product Superwall has no record of", () => {
    render(<ProductsPanel products={products} samples={{ products: { pro_5999_year: annual } }} />);
    const weekly = within(screen.getByRole("region", { name: "weekly" }));
    expect(weekly.getByText("Not in Superwall")).toBeTruthy();
    expect(weekly.getByText(/no product with this identifier/)).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "annual" })).queryByText("Not in Superwall"),
    ).toBeNull();
  });

  it("never calls a product missing when the catalog couldn't load", () => {
    render(<ProductsPanel products={products} samples={{ unreachable: "the API is down" }} />);
    expect(screen.getByRole("status").textContent).toContain("the API is down");
    expect(screen.getAllByText("Couldn’t check")).toHaveLength(2);
    expect(screen.queryByText("Not in Superwall")).toBeNull();
  });

  it("shows slots as checking until the catalog arrives", () => {
    render(<ProductsPanel products={products} samples={{}} />);
    expect(screen.getAllByText("Checking…")).toHaveLength(2);
    expect(screen.queryByText("Not in Superwall")).toBeNull();
  });

  it("says a known product has no price rather than inventing one", () => {
    render(
      <ProductsPanel
        products={{ lifetime: "lifetime" }}
        samples={{ products: { lifetime: { identifier: "lifetime" } } }}
      />,
    );
    expect(screen.getByText("No price on record")).toBeTruthy();
  });

  it("shows how to add products when the paywall declares none", () => {
    render(<ProductsPanel products={undefined} samples={{ products: {} }} />);
    expect(screen.getByText("No products")).toBeTruthy();
    expect(screen.getByText(`products: { primary: "pro_year" }`)).toBeTruthy();
  });

  it("copies a slot's identifier and confirms it briefly", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ProductsPanel products={{ annual: "pro_5999_year" }} samples={{}} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy annual identifier" }));
    });
    expect(writeText).toHaveBeenCalledWith("pro_5999_year");
    expect(screen.getByRole("button", { name: "Copied annual identifier" })).toBeTruthy();

    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByRole("button", { name: "Copy annual identifier" })).toBeTruthy();
  });

  it("does not claim a copy that failed", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ProductsPanel products={{ annual: "pro_5999_year" }} samples={{}} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy annual identifier" }));
    });
    expect(screen.getByRole("button", { name: "Copy annual identifier" })).toBeTruthy();
  });
});
