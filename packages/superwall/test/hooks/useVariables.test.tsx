import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDevice, useUser, useVariables } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

describe("useVariables", () => {
  it("exposes device, user, and params variable groups", async () => {
    const { result } = renderWithProvider(() => useVariables(), {
      host: { user: { firstName: "Ada" }, params: { source: "onboarding" } },
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

  it("says which surface hosts the paywall, apart from the platform the user is on", async () => {
    window.history.replaceState(null, "", "/?client_surface=web-sdk");
    try {
      const { result } = renderWithProvider(() => useDevice());
      await flush();
      expect(result.current.host).toBe("web-sdk");
      expect(result.current.hostPlatform).toBe("ios");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});

describe("useUser", () => {
  it("is the user attributes on their own", async () => {
    const { result } = renderWithProvider(() => useUser(), {
      host: { user: { firstName: "Ada" } },
    });
    await flush();
    expect(result.current).toEqual({ firstName: "Ada" });
  });
});
