import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePurchase } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

describe("usePurchase when the SDK reports a failure", () => {
  it("resolves as failed with the sdk reason, and clears the pending state", async () => {
    const { result } = renderWithProvider(() => usePurchase(), { host: { purchase: "failed" } });
    await flush();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase("primary");
    });

    expect(outcome).toMatchObject({ status: "failed", reason: "unknown" });
    expect(result.current.isPurchasing).toBe(false);
    expect(result.current.failure?.reason).toBe("unknown");
    expect(result.current.transaction).toBeUndefined();
  });

  it("hands a Stripe product to the host when the page has no API key", async () => {
    const { result } = renderWithProvider(() => usePurchase(), {
      config: { checkout: "sheet", products: { primary: "test:price_1:no-trial" } },
      host: {
        products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
        purchase: "abandoned",
      },
    });
    await flush();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase("primary");
    });

    expect(outcome).toMatchObject({ status: "abandoned" });
  });
});

describe("purchase callbacks for a store purchase made by the SDK", () => {
  const recorder = () => {
    const calls: unknown[][] = [];
    const callbacks = {
      onStart: (product: { reference: string }) => calls.push(["start", product.reference]),
      onSubmit: (product: { reference: string }) => calls.push(["submit", product.reference]),
      onComplete: (product: { reference: string }) => calls.push(["complete", product.reference]),
      onAbandon: (product: { reference: string }) => calls.push(["abandon", product.reference]),
      onFailure: (failure: { reason: string; product: { reference: string } }) =>
        calls.push(["failure", failure.reason, failure.product.reference]),
    };
    return { calls, callbacks };
  };

  it.each([
    ["completed", ["complete", "primary"]],
    ["abandoned", ["abandon", "primary"]],
    ["failed", ["failure", "unknown", "primary"]],
  ] as const)("fires start, then the end of a %s purchase, on every hook", async (ending, last) => {
    const watcher = recorder();
    const { result } = renderWithProvider(
      () => ({ buyer: usePurchase(), watcher: usePurchase(watcher.callbacks) }),
      { host: { purchase: ending } },
    );
    await flush();

    await act(async () => {
      await result.current.buyer.purchase("primary");
    });

    expect(watcher.calls).toEqual([["start", "primary"], last]);
  });

  it("fires a purchase() call's own callbacks for that call only", async () => {
    const own = recorder();
    const { result } = renderWithProvider(() => usePurchase(), { host: { purchase: "failed" } });
    await flush();

    await act(async () => {
      await result.current.purchase("primary", own.callbacks);
    });
    await act(async () => {
      await result.current.purchase("primary");
    });

    expect(own.calls).toEqual([
      ["start", "primary"],
      ["failure", "unknown", "primary"],
    ]);
  });
});
