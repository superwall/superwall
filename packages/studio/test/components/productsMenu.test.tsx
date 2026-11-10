import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductsMenu } from "../../src/components/menus/ProductsMenu";
import { productVariables } from "../../src/lib/products";

const annual = productVariables({
  identifier: "pro_5999_year",
  price: { amount: 5999, currency: "USD" },
  subscription: { period: "year", period_count: 1, trial_period_days: 7 },
});

const products = { annual: "pro_5999_year", weekly: "pro_499_week" };

const open = (name: string | RegExp = /^Products/) =>
  fireEvent.click(screen.getByRole("button", { name }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProductsMenu", () => {
  it("lists every slot in config order with what it sells", () => {
    render(
      <ProductsMenu
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
    open();

    const slots = screen.getAllByRole("region");
    expect(slots.map((slot) => slot.getAttribute("aria-label"))).toEqual(["annual", "weekly"]);

    const first = within(slots[0]!);
    expect(first.getByText("pro_5999_year")).toBeTruthy();
    expect(first.getByText("$59.99 / year · 7-day free trial")).toBeTruthy();
    expect(first.getByText("$5.00 / month · $1.15 / week")).toBeTruthy();

    const second = within(slots[1]!);
    expect(second.getByText("$4.99 / week")).toBeTruthy();
    expect(second.queryByText(/free trial/)).toBeNull();
    expect(screen.getByText(/Push and promote to ship/)).toBeTruthy();
  });

  it("flags a slot whose product Superwall has no record of", () => {
    render(<ProductsMenu products={products} samples={{ products: { pro_5999_year: annual } }} />);
    open();
    const weekly = within(screen.getByRole("region", { name: "weekly" }));
    expect(weekly.getByText("Not in Superwall")).toBeTruthy();
    expect(weekly.getByText("No product with this identifier")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Products, 1 missing" })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "annual" })).queryByText("Not in Superwall"),
    ).toBeNull();
  });

  it("never calls a product missing when the catalog couldn't load", () => {
    render(<ProductsMenu products={products} samples={{ unreachable: "the API is down" }} />);
    open();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByText("Couldn’t check")).toHaveLength(2);
    expect(screen.queryByText("Not in Superwall")).toBeNull();
    expect(screen.getByRole("button", { name: "Products, couldn’t check" })).toBeTruthy();
  });

  it("closes on a second press, on Escape and on a press outside", () => {
    render(<ProductsMenu products={products} samples={{ products: { pro_5999_year: annual } }} />);
    const button = screen.getByRole("button", { name: "Products, 1 missing" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Products" })).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByText("pro_5999_year"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows slots as checking while the catalog is on its way", () => {
    render(<ProductsMenu products={products} samples={{}} pending />);
    open();
    expect(screen.getAllByText("Checking…")).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Not in Superwall")).toBeNull();
  });

  it("says there is no catalog when the host sent none, never checking forever", () => {
    render(<ProductsMenu products={products} samples={{}} />);
    open();
    expect(screen.queryByText("Checking…")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "No product catalog to check these against.",
    );
    expect(screen.getAllByText("Couldn’t check")).toHaveLength(2);
    expect(screen.queryByText("Not in Superwall")).toBeNull();
  });

  it("says a known product has no price rather than inventing one", () => {
    render(
      <ProductsMenu
        products={{ lifetime: "lifetime" }}
        samples={{ products: { lifetime: { identifier: "lifetime" } } }}
      />,
    );
    open();
    expect(screen.getByText("No price on record")).toBeTruthy();
  });

  it("shows how to add products when the paywall declares none", () => {
    render(<ProductsMenu products={undefined} samples={{ products: {} }} />);
    open();
    expect(screen.getByText("This paywall sells nothing yet.")).toBeTruthy();
    expect(screen.getByText(`products: { primary: "pro_year" }`)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("copies a slot's identifier and confirms it briefly", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ProductsMenu products={{ annual: "pro_5999_year" }} samples={{}} />);
    open();

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
    render(<ProductsMenu products={{ annual: "pro_5999_year" }} samples={{}} />);
    open();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy annual identifier" }));
    });
    expect(screen.getByRole("button", { name: "Copy annual identifier" })).toBeTruthy();
  });
});
