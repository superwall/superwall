import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProducts } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

describe("useProducts", () => {
  it("delivers the config's product slots with no invented variables", async () => {
    const { result } = renderWithProvider(() => useProducts());
    await flush();

    await waitFor(() => expect(result.current.products).toHaveLength(2));
    const primary = result.current.getProduct("primary");
    expect(primary?.productId).toBe("pro_3999_year");

    // Prices come from Superwall alone. Without a host there is nothing to
    // report, and a paywall must see undefined rather than a plausible lie.
    expect(primary?.variables.price).toBeUndefined();
    expect(primary?.variables.period).toBeUndefined();
    expect(primary?.variables.trialPeriodDays).toBeUndefined();
    expect(primary?.variables.identifier).toBe("pro_3999_year");
  });
});
