import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PurchaseButton, useCheckout } from "../../../src/checkout";
import { CheckoutContext, type UseCheckoutResult } from "../../../src/checkout/form/useCheckout";
import { ExpressCheckoutElement } from "../../../src/checkout/stripe";

const OtherStoreForm = ({
  value,
  children,
}: {
  value: UseCheckoutResult;
  children: React.ReactNode;
}) => <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;

const formState = (overrides: Partial<UseCheckoutResult> = {}): UseCheckoutResult => ({
  status: "ready",
  canSubmit: true,
  submit: vi.fn(async () => ({ status: "completed" as const, product: {} as never })),
  ...overrides,
});

const Summary = () => {
  const { status, amounts } = useCheckout();
  return (
    <p>
      {status} {amounts ? `${amounts.dueNow} ${amounts.currency}` : "no price"}
    </p>
  );
};

describe("the store-agnostic checkout API", () => {
  it("serves a CTA in any store's form, not only Stripe's", () => {
    const value = formState({
      amounts: { currency: "eur", dueNow: 0, recurring: 999, interval: "month", intervalCount: 1 },
    });
    render(
      <OtherStoreForm value={value}>
        <Summary />
        <PurchaseButton>Pay</PurchaseButton>
      </OtherStoreForm>,
    );
    expect(screen.getByText("ready 0 eur")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(value.submit).toHaveBeenCalledOnce();
  });

  for (const [status, canSubmit] of [
    ["preparing", false],
    ["paying", false],
    ["unavailable", false],
    ["ready", true],
  ] as const) {
    it(`marks the button for a form that is ${status}`, () => {
      render(
        <OtherStoreForm value={formState({ status, canSubmit })}>
          <PurchaseButton>Pay</PurchaseButton>
        </OtherStoreForm>,
      );
      const button = screen.getByRole("button", { name: "Pay" }) as HTMLButtonElement;
      expect(button.disabled).toBe(!canSubmit);
      expect(button.dataset.status).toBe(status);
      expect(button.getAttribute("aria-busy")).toBe(String(status === "paying"));
    });
  }

  it("lets the button's own onClick stop the payment", () => {
    const value = formState();
    render(
      <OtherStoreForm value={value}>
        <PurchaseButton onClick={(event) => event.preventDefault()}>Pay</PurchaseButton>
      </OtherStoreForm>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(value.submit).not.toHaveBeenCalled();
  });

  it("says where they belong when rendered outside any form", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<PurchaseButton>Pay</PurchaseButton>)).toThrow(
      "<PurchaseButton> must be rendered inside a checkout form, such as <StripeCheckout>.",
    );
    expect(() => render(<ExpressCheckoutElement />)).toThrow(
      "<ExpressCheckoutElement> must be rendered inside <StripeCheckout>.",
    );
  });

  it("keeps every Stripe name out of superwall/checkout", async () => {
    const root = Object.keys(await import("../../../src/checkout"));
    const stripe = Object.keys(await import("../../../src/checkout/stripe"));
    expect(root.filter((name) => /stripe|element/i.test(name))).toEqual([]);
    expect(stripe).toEqual(
      expect.arrayContaining([
        "StripeCheckout",
        "ExpressCheckoutElement",
        "PaymentElement",
        "LinkAuthenticationElement",
        "AddressElement",
        "PaymentMethodMessagingElement",
        "useStripe",
        "useElements",
      ]),
    );
  });
});
