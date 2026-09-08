import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProducts } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

describe("useProducts", () => {
  it("delivers exactly the products the host sent, with no invented variables", async () => {
    const { result } = renderWithProvider(() => useProducts());
    await flush();

    await waitFor(() => expect(result.current.products).toHaveLength(2));
    const primary = result.current.getProduct("primary");
    expect(primary?.productId).toBe("pro_3999_year");
    expect(primary?.source).toBe("sdk");

    // Prices come from Superwall alone. A host that sent none leaves them
    // undefined; a paywall must see that rather than a plausible lie.
    expect(primary?.variables).toEqual({});
  });

  it("has no products at all until a host delivers them", async () => {
    const { result } = renderWithProvider(() => useProducts(), { host: { products: [] } });
    await flush();

    expect(result.current.products).toEqual([]);
    expect(result.current.getProduct("primary")).toBeUndefined();
  });
});
