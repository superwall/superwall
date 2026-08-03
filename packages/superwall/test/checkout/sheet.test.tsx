import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

// Stripe's own bundle fetches js.stripe.com and mounts a cross-origin iframe,
// neither of which exists in jsdom. Standing in for it keeps these tests about
// our sheet — when it opens, when it refuses to close — rather than Stripe's.
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: () => Promise.resolve({}),
}));
type StripeOptions = {
  onComplete: () => void;
  onAnalyticsEvent: (e: { eventType: string }) => void;
};
const stripe: { options?: StripeOptions } = {};

vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: ({
    children,
    options,
  }: React.PropsWithChildren<{ options: StripeOptions }>) => {
    stripe.options = options;
    return <>{children}</>;
  },
  EmbeddedCheckout: () => <div data-testid="stripe-checkout" />,
}));

// jsdom ships no matchMedia; the sheet asks it whether to lay out as a phone
// bottom-sheet or a desktop modal. Small viewport keeps these tests on the
// path a shopper actually takes.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

// The sheet watches its scroll area to decide whether to show fade edges.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { SuperwallCheckout, checkoutEvents } = await import("../../src/checkout");
const { SuperwallProvider } = await import("../../src");
const { testConfig } = await import("../helpers");

const session = {
  directive: "embedded" as const,
  clientSecret: "cs_test_secret",
  publishableKey: "pk_test_123",
  checkoutContextId: "ctx_1",
  checkoutSessionId: "sw_checkout_1",
  referenceName: "annual",
};

const mount = () =>
  render(
    <SuperwallProvider config={testConfig} mock>
      <SuperwallCheckout />
    </SuperwallProvider>,
  );

const open = async () => {
  await act(async () => {
    checkoutEvents.dispatch("SHEET_OPEN", { session });
    await Promise.resolve();
  });
};

// Stripe reports the submit through its own callback — the sheet locks itself
// there, not off the event bus, so anything less would test the wrong path.
const submit = async () => {
  await act(async () => {
    stripe.options?.onAnalyticsEvent({ eventType: "checkoutSubmitted" });
    await Promise.resolve();
  });
};

describe("the checkout sheet", () => {
  it("renders nothing until a purchase opens it", () => {
    mount();

    expect(screen.queryByTestId("stripe-checkout")).toBeNull();
  });

  it("shows Stripe's checkout once a session opens", async () => {
    mount();
    await open();

    expect(screen.getByTestId("stripe-checkout")).toBeDefined();
    expect(document.querySelector('[data-state="open"]')).not.toBeNull();
  });

  it("closes on request, and says so, so a host can settle the purchase", async () => {
    mount();
    await open();

    const closed = vi.fn();
    const stop = checkoutEvents.subscribe("SHEET_CLOSE", closed);
    await act(async () => {
      (document.querySelector(".checkout-backdrop") as HTMLElement).click();
      await Promise.resolve();
    });
    stop();

    expect(closed).toHaveBeenCalled();
  });

  it("reports a completed payment and closes, so the host can settle it", async () => {
    mount();
    await open();

    const succeeded = vi.fn();
    const stop = checkoutEvents.subscribe("PAYMENT_SUCCESS", succeeded);
    await act(async () => {
      stripe.options?.onComplete();
      await Promise.resolve();
    });
    stop();

    expect(succeeded).toHaveBeenCalled();
    expect(document.querySelector('[data-state="open"]')).toBeNull();
  });

  it("unlocks after a failed submit, so a shopper is not trapped", async () => {
    mount();
    await open();
    await submit();
    await act(async () => {
      stripe.options?.onAnalyticsEvent({ eventType: "checkoutSubmitFailed" });
      await Promise.resolve();
    });

    const closed = vi.fn();
    const stop = checkoutEvents.subscribe("SHEET_CLOSE", closed);
    await act(async () => {
      (document.querySelector(".checkout-backdrop") as HTMLElement).click();
      await Promise.resolve();
    });
    stop();

    expect(closed).toHaveBeenCalled();
  });

  /**
   * The guard that matters most: Stripe has the payment in flight, and tearing
   * the sheet down here would strand a charge the shopper has already
   * authorized.
   */
  it("refuses to close while a payment is processing", async () => {
    mount();
    await open();
    await submit();

    const closed = vi.fn();
    const stop = checkoutEvents.subscribe("SHEET_CLOSE", closed);
    await act(async () => {
      (document.querySelector(".checkout-backdrop") as HTMLElement).click();
      await Promise.resolve();
    });
    stop();

    expect(closed).not.toHaveBeenCalled();
    expect(screen.getByTestId("stripe-checkout")).toBeDefined();
  });
});
