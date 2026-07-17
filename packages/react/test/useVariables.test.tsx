import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDevice, useTrialEligibility, useVariables } from "../src";
import { flush, renderWithProvider } from "./helpers";

describe("useTrialEligibility", () => {
  it("reports trial eligibility from the mock host", async () => {
    const { result } = renderWithProvider(() => useTrialEligibility());
    await flush();
    await waitFor(() => expect(result.current.eligible).toBe(true));
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
