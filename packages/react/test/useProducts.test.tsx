import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProducts } from "../src";
import { flush, renderWithProvider } from "./helpers";

describe("useProducts", () => {
  it("delivers mock products with synthesized SDK variables", async () => {
    const { result } = renderWithProvider(() => useProducts());
    await flush();

    await waitFor(() => expect(result.current.products).toHaveLength(2));
    expect(result.current.getProduct("primary")?.variables).toMatchObject({
      price: "$39.99",
      period: "year",
      trialPeriodDays: 7,
    });
    expect(result.current.getProduct("primary")?.productId).toBe("pro_3999_year");
  });
});
