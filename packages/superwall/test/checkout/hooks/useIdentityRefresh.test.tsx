import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuperwallProvider, type SuperwallSession } from "../../../src";
import { checkoutEvents } from "../../../src/checkout/events";
import { sessionsFor } from "../../../src/checkout/flow";
import { useIdentityRefresh } from "../../../src/checkout/hooks/useIdentityRefresh";
import { useSuperwallSession } from "../../../src/hooks";
import { createHost, flush, testConfig, type HostProps } from "../../helpers";

const sheetConfig = {
  ...testConfig,
  checkout: "sheet" as const,
  products: { primary: "test:price_1:no-trial" },
};

const sheetHost: HostProps = {
  products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
  device: { platform: "Android", publicApiKey: "pk_test", sdkVersionPadded: "004.014.000" },
};

const renderRefresh = (hostProps: HostProps = sheetHost) => {
  const { transport, host } = createHost(hostProps);
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <SuperwallProvider config={sheetConfig} transport={transport}>
      {children}
    </SuperwallProvider>
  );
  const view = renderHook(
    (): SuperwallSession => {
      useIdentityRefresh();
      return useSuperwallSession();
    },
    { wrapper },
  );
  return { ...view, host };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useIdentityRefresh", () => {
  it("drops cached sessions and prefetches again when the paywall sets the email", async () => {
    const invalidated = vi.fn();
    const unsubscribe = checkoutEvents.subscribe("SESSION_INVALIDATED", invalidated);
    const { result, unmount } = renderRefresh();
    await flush();
    const prefetch = vi.spyOn(sessionsFor(result.current), "prefetch").mockResolvedValue(null);

    act(() => {
      result.current.setUserAttributes({ email: "ada@example.com" });
    });

    expect(invalidated).toHaveBeenCalledWith({ reason: "customer identity changed" });
    expect(prefetch).toHaveBeenCalledWith(
      expect.objectContaining({ referenceName: "primary", silent: true }),
    );
    unsubscribe();
    unmount();
  });

  it("reacts to fresher variables from the host the same way", async () => {
    const invalidated = vi.fn();
    const unsubscribe = checkoutEvents.subscribe("SESSION_INVALIDATED", invalidated);
    const { result, host, unmount } = renderRefresh();
    await flush();
    const prefetch = vi.spyOn(sessionsFor(result.current), "prefetch").mockResolvedValue(null);

    act(() => {
      host.update({ user: { stripe_customer_id: "cus_123" } });
    });
    await flush();

    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledTimes(1);
    unsubscribe();
    unmount();
  });

  it("leaves sessions alone while the identity is unchanged", async () => {
    const invalidated = vi.fn();
    const unsubscribe = checkoutEvents.subscribe("SESSION_INVALIDATED", invalidated);
    // An email the host knew from the start is the baseline, not a change:
    // the prefetch on mount already carried it.
    const { result, unmount } = renderRefresh({
      ...sheetHost,
      user: { email: "ada@example.com" },
    });
    await flush();

    act(() => {
      // Same email again, plus an attribute checkout does not read.
      result.current.setUserAttributes({ email: "ada@example.com", plan: "pro" });
    });
    await flush();

    expect(invalidated).not.toHaveBeenCalled();
    unsubscribe();
    unmount();
  });

  it("treats a host re-sending the same variables as no change", async () => {
    const invalidated = vi.fn();
    const unsubscribe = checkoutEvents.subscribe("SESSION_INVALIDATED", invalidated);
    const { host, unmount } = renderRefresh({ ...sheetHost, user: { email: "ada@example.com" } });
    await flush();

    act(() => {
      host.update({ device: { publicApiKey: "" } });
    });
    await flush();
    act(() => {
      host.update({ device: { publicApiKey: "pk_test" }, user: { email: "ada@example.com" } });
    });
    await flush();

    expect(invalidated).not.toHaveBeenCalled();
    unsubscribe();
    unmount();
  });

  it("does nothing before the host has delivered its variables", async () => {
    const invalidated = vi.fn();
    const unsubscribe = checkoutEvents.subscribe("SESSION_INVALIDATED", invalidated);
    // No public API key: no host variables yet, and nothing to prefetch.
    const { result, unmount } = renderRefresh({ products: sheetHost.products });
    await flush();

    act(() => {
      result.current.setUserAttributes({ email: "ada@example.com" });
    });
    await flush();

    expect(invalidated).not.toHaveBeenCalled();
    unsubscribe();
    unmount();
  });
});
