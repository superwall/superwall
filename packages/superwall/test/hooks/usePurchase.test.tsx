import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePurchase } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

describe("usePurchase", () => {
  it("tracks the purchase lifecycle without userland state", async () => {
    const { result } = renderWithProvider(() => usePurchase());
    await flush();

    expect(result.current.isPurchasing).toBe(false);

    let purchasePromise: Promise<unknown> | undefined;
    act(() => {
      purchasePromise = result.current.purchase("primary");
    });

    expect(result.current.isPurchasing).toBe(true);
    expect(result.current.pendingProduct?.reference).toBe("primary");

    await flush();
    await purchasePromise;

    expect(result.current.isPurchasing).toBe(false);
    expect(result.current.transaction).toMatchObject({
      status: "completed",
      product: { reference: "primary" },
    });
  });

  it("resolves abandonment as a purchase result", async () => {
    const { result } = renderWithProvider(() => usePurchase(), {
      host: { purchase: "abandoned" },
    });
    await flush();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase("primary");
    });

    expect(outcome).toMatchObject({ status: "abandoned" });
    expect(result.current.isPurchasing).toBe(false);
  });
});
