import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDevice, useTrialEligibility, useVariables } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

describe("useTrialEligibility", () => {
  it("reports trial eligibility from the product data it was given", async () => {
    const { result } = renderWithProvider(() => useTrialEligibility(), {
      mock: {
        products: [{ reference: "primary", productId: "pro", variables: { trialPeriodDays: 7 } }],
      },
    });
    await flush();
    await waitFor(() => expect(result.current.eligible).toBe(true));
  });

  it("reports no trial when nothing says there is one", async () => {
    const { result } = renderWithProvider(() => useTrialEligibility());
    await flush();
    await waitFor(() => expect(result.current.eligible).toBe(false));
  });
});

describe("useVariables", () => {
  it("exposes device, user, and params variable groups", async () => {
    const { result } = renderWithProvider(() => useVariables(), {
      mock: { user: { firstName: "Ada" }, params: { source: "onboarding" } },
    });
    await flush();

    await waitFor(() => expect(result.current.device.platform).toBe("iOS"));
    expect(result.current.user).toEqual({ firstName: "Ada" });
    expect(result.current.params).toEqual({ source: "onboarding" });
  });
});

describe("useDevice", () => {
  it("adds live viewport orientation to device variables", async () => {
    const { result } = renderWithProvider(() => useDevice());
    await flush();
    expect(result.current.orientation).toBe("portrait");
  });
});
