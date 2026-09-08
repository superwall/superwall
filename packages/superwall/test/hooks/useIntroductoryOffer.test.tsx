import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIntroductoryOffer } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

describe("useIntroductoryOffer", () => {
  it("reports eligibility from the host's prefix, derived from the product data it sent", async () => {
    const { result } = renderWithProvider(() => useIntroductoryOffer(), {
      host: {
        products: [{ reference: "primary", productId: "pro", variables: { trialPeriodDays: 7 } }],
      },
    });
    await flush();
    await waitFor(() => expect(result.current.eligible).toBe(true));
  });

  it("is false when the host says so, whatever the products carry", async () => {
    const { result } = renderWithProvider(() => useIntroductoryOffer(), {
      host: {
        products: [{ reference: "primary", productId: "pro", variables: { trialPeriodDays: 7 } }],
        introductoryOfferEligible: false,
      },
    });
    await flush();
    await waitFor(() => expect(result.current.eligible).toBe(false));
  });

  it("reports no offer when nothing says there is one", async () => {
    const { result } = renderWithProvider(() => useIntroductoryOffer());
    await flush();
    await waitFor(() => expect(result.current.eligible).toBe(false));
  });
});
