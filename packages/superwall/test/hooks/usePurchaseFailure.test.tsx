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

    expect(outcome).toMatchObject({ status: "failed", reason: "sdk" });
    expect(result.current.isPurchasing).toBe(false);
    expect(result.current.failure?.reason).toBe("sdk");
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
