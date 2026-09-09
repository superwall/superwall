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

const { SuperwallCheckout, checkoutEvents } = await import("../../../src/checkout");
const { SuperwallProvider } = await import("../../../src");
const { createHost, testConfig } = await import("../../helpers");

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
    <SuperwallProvider config={testConfig} transport={createHost().transport}>
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

describe("the sheet's chrome", () => {
  it("tells Stripe's rendered event to the pool, so a warmed sheet opens at once", async () => {
    mount();
    await open();

    const ready = vi.fn();
    const stop = checkoutEvents.subscribe("EMBEDDED_READY", ready);
    await act(async () => {
      stripe.options?.onAnalyticsEvent({ eventType: "checkoutRendered" });
      await Promise.resolve();
    });
    stop();

    expect(ready).toHaveBeenCalledWith({ clientSecret: session.clientSecret });
  });

  it("closes on Escape and ignores other keys", async () => {
    mount();
    await open();

    const closed = vi.fn();
    const stop = checkoutEvents.subscribe("SHEET_CLOSE", closed);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await Promise.resolve();
    });
    expect(closed).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
    });
    stop();

    expect(closed).toHaveBeenCalled();
  });

  it("keeps a click inside the sheet from closing it", async () => {
    mount();
    await open();

    const closed = vi.fn();
    const stop = checkoutEvents.subscribe("SHEET_CLOSE", closed);
    await act(async () => {
      (document.querySelector(".checkout-sheet-outer") as HTMLElement).click();
      await Promise.resolve();
    });
    stop();

    expect(closed).not.toHaveBeenCalled();
  });

  it("lays out over a fullscreen paywall as fullscreen, and over a modal one as a sheet", async () => {
    const fullscreen = render(
      <SuperwallProvider
        config={{ ...testConfig, presentation: { style: "push" } }}
        transport={createHost().transport}
      >
        <SuperwallCheckout />
      </SuperwallProvider>,
    );
    await open();
    expect(document.querySelector('[data-fullscreen="true"]')).not.toBeNull();
    fullscreen.unmount();

    render(
      <SuperwallProvider
        config={{ ...testConfig, presentation: { style: "modal" } }}
        transport={createHost().transport}
      >
        <SuperwallCheckout />
      </SuperwallProvider>,
    );
    await open();
    expect(document.querySelector('[data-fullscreen="false"]')).not.toBeNull();
  });

  it("shows the loading overlay while a wallet purchase is in flight", async () => {
    const { startLoading, stopLoading } = await import("../../../src/checkout/loading");
    mount();

    await act(async () => {
      startLoading();
      await Promise.resolve();
    });
    const overlay = document.querySelector('[aria-hidden="false"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("style")).toContain("visibility: visible");

    await act(async () => {
      stopLoading();
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-hidden="true"]')?.getAttribute("style")).toContain(
      "visibility: hidden",
    );
  });
});

describe("a sheet that is pooled but not open", () => {
  it("renders closed, so Stripe can warm up behind the paywall", async () => {
    mount();
    await act(async () => {
      checkoutEvents.dispatch("SESSION_CREATED", session);
      await Promise.resolve();
    });

    expect(document.querySelector('[data-state="closed"]')).not.toBeNull();
    expect(document.querySelector('[data-state="open"]')).toBeNull();
  });
});

describe("on a viewport wide enough for a modal", () => {
  it("lays the sheet out as a desktop modal with a capped height", async () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    mount();
    await open();

    expect(document.querySelector('[data-viewport="large"]')).not.toBeNull();
    expect(document.querySelector<HTMLElement>(".checkout-scroll-container")?.style.maxHeight).toBe(
      "600px",
    );
  });
});

describe("a sheet that opens before the browser paints", () => {
  it("stays closed until a frame has passed, so it animates in rather than appearing", async () => {
    const rafs: FrameRequestCallback[] = [];
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      rafs.push(callback);
      return rafs.length;
    }) as typeof window.requestAnimationFrame;

    mount();
    await open();
    expect(document.querySelector('.checkout-sheet-wrapper[data-state="open"]')).toBeNull();

    await act(async () => {
      rafs.forEach((callback) => callback(0));
      await Promise.resolve();
    });
    expect(document.querySelector('.checkout-sheet-wrapper[data-state="open"]')).not.toBeNull();

    window.requestAnimationFrame = raf;
  });
});
