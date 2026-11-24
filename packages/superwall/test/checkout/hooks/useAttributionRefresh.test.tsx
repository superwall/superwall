import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuperwallProvider, type SuperwallSession } from "../../../src";
import { checkoutEvents } from "../../../src/checkout/events";
import { SuperwallCheckout } from "../../../src/checkout";
import { usePurchase, useSuperwallSession } from "../../../src/hooks";
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

const sessionBodies = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls
    .filter(([url]) => String(url).endsWith("checkout/session"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

const renderCheckout = (mount: "checkout" | "purchase" = "checkout") => {
  const { transport, host } = createHost(sheetHost);
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <SuperwallProvider config={sheetConfig} transport={transport}>
      {mount === "checkout" ? <SuperwallCheckout /> : null}
      {children}
    </SuperwallProvider>
  );
  const view = renderHook(
    (): SuperwallSession => {
      if (mount === "purchase") usePurchase();
      return useSuperwallSession();
    },
    { wrapper },
  );
  return { ...view, host };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(["checkout", "purchase"] as const)("useAttributionRefresh under %s", (mount) => {
  it("re-warms with the experiment a host sent after the first warm", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        directive: "embedded",
        checkoutSessionId: "sw_checkout_1",
        clientSecret: "cs_secret",
        publishableKey: "pk_test",
        checkoutContextId: "ctx_1",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const invalidated = vi.fn();
    const unsubscribe = checkoutEvents.subscribe("SESSION_INVALIDATED", invalidated);
    const { host, unmount } = renderCheckout(mount);
    await flush();

    act(() => {
      host.send([
        {
          event_name: "paywall_open",
          paywall_id: "295780",
          paywall_identifier: "paywall-simple-v2-5999",
          paywall_name: "Simple v2",
        },
      ]);
    });
    await flush();
    const first = sessionBodies(fetch);
    expect(first.at(-1)?.context.paywall).toMatchObject({
      paywallId: "295780",
      paywallName: "Simple v2",
    });
    expect(first.at(-1)?.context.experiment).toMatchObject({ experimentId: "0" });

    act(() => {
      host.update({ experiment: { experimentId: "207076", variantId: "711240", campaignId: "1" } });
    });
    await flush();

    expect(invalidated).toHaveBeenCalledWith({ reason: "paywall attribution changed" });
    expect(sessionBodies(fetch).at(-1)?.context.experiment).toMatchObject({
      experimentId: "207076",
      variantId: "711240",
    });
    unsubscribe();
    unmount();
  });
});
