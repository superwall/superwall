import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { useHostDiscount } from "../../../src/checkout/hooks/useHostDiscount";
import { sessionsFor } from "../../../src/checkout/flow";
import { useSuperwallSession } from "../../../src/hooks";
import { createHost, flush, testConfig } from "../../helpers";
import { renderHook } from "@testing-library/react";
import * as React from "react";
import { SuperwallProvider } from "../../../src";

const products = [
  { reference: "primary", productId: "test:price_1:no-trial" },
  { reference: "secondary", productId: "test:price_2:no-trial" },
];

const validation = (code: string, applies = true) => ({
  valid: true,
  discount: { code, promotionCodeId: `promo_${code}`, couponId: "c_1", percentOff: 10 },
  products: [
    {
      productIdentifier: "test:price_1:no-trial",
      applies,
      originalAmount: 1999,
      discountedAmount: applies ? 1799 : 1999,
      currency: "usd",
    },
  ],
});

const embedded = {
  checkoutContextId: "ctx_1",
  directive: {
    directive: "embedded",
    checkoutSessionId: "sw_checkout_1",
    publishableKey: "pk_test",
    clientSecret: "cs_secret",
  },
};

const mount = async (host: Parameters<typeof createHost>[0] = {}) => {
  const outgoing: TOutgoingMessage[] = [];
  const created = createHost({
    products,
    device: { publicApiKey: "pk_test" },
    onOutgoing: (message) => outgoing.push(message),
    ...host,
  });
  const rendered = renderHook(
    () => {
      useHostDiscount();
      return useSuperwallSession();
    },
    {
      wrapper: ({ children }: React.PropsWithChildren) => (
        <SuperwallProvider
          config={{ ...testConfig, checkout: "sheet" }}
          transport={created.transport}
        >
          {children}
        </SuperwallProvider>
      ),
    },
  );
  await flush();
  return { ...rendered, host: created.host, outgoing };
};

const redemptions = (outgoing: readonly TOutgoingMessage[]) =>
  outgoing.filter((message) => message.event_name === "discount_redemption_result");

const stubFetch = (discount: unknown) => {
  const fetchMock = vi.fn(async (url: string) =>
    url.includes("checkout/discount")
      ? new Response(JSON.stringify(discount), { status: 200 })
      : new Response(JSON.stringify(embedded), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a host that redeems a code for the paywall", () => {
  it("applies it, re-warms checkout with it, and reports what it applied to", async () => {
    stubFetch(validation("SAVE10"));
    const { result, host, outgoing } = await mount();

    await act(async () => {
      host.send([{ event_name: "redeem_discount", code: " SAVE10 " }]);
      await flush();
    });

    expect(sessionsFor(result.current).discounts.applied?.code).toBe("SAVE10");
    expect(redemptions(outgoing)).toEqual([
      {
        event_name: "discount_redemption_result",
        code: "SAVE10",
        valid: true,
        appliedProductCount: 1,
      },
    ]);
  });

  it("reports a code the backend refuses, and applies nothing", async () => {
    stubFetch({ valid: false, reason: "code_not_found" });
    const { result, host, outgoing } = await mount();

    await act(async () => {
      host.send([{ event_name: "redeem_discount", code: "NOPE" }]);
      await flush();
    });

    expect(sessionsFor(result.current).discounts.applied).toBeNull();
    expect(redemptions(outgoing)).toEqual([
      {
        event_name: "discount_redemption_result",
        code: "NOPE",
        valid: false,
        reason: "code_not_found",
      },
    ]);
  });

  it("reports a code that applies to nothing on this paywall", async () => {
    stubFetch(validation("SAVE10", false));
    const { host, outgoing } = await mount();

    await act(async () => {
      host.send([{ event_name: "redeem_discount", code: "SAVE10" }]);
      await flush();
    });

    expect(redemptions(outgoing)).toEqual([
      {
        event_name: "discount_redemption_result",
        code: "SAVE10",
        valid: false,
        reason: "no_applicable_products",
      },
    ]);
  });

  it("clears an applied code when the host sends an empty one, and says nothing back", async () => {
    stubFetch(validation("SAVE10"));
    const { result, host, outgoing } = await mount();

    await act(async () => {
      host.send([{ event_name: "redeem_discount", code: "SAVE10" }]);
      await flush();
    });
    expect(sessionsFor(result.current).discounts.applied).not.toBeNull();

    await act(async () => {
      host.send([{ event_name: "redeem_discount", code: "   " }]);
      await flush();
    });

    expect(sessionsFor(result.current).discounts.applied).toBeNull();
    expect(redemptions(outgoing)).toHaveLength(1);
  });

  it("keeps the codes in the order they arrived, so a slow answer cannot win", async () => {
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.includes("checkout/discount")) {
          return new Response(JSON.stringify(embedded), { status: 200 });
        }
        const { code } = JSON.parse(String(init?.body)) as { code: string };
        order.push(code);
        if (code === "SLOW") await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify(validation(code)), { status: 200 });
      }),
    );
    const { result, host } = await mount();

    await act(async () => {
      host.send([{ event_name: "redeem_discount", code: "SLOW" }]);
      host.send([{ event_name: "redeem_discount", code: "FAST" }]);
      await new Promise((resolve) => setTimeout(resolve, 60));
      await flush();
    });

    expect(order).toEqual(["SLOW", "FAST"]);
    expect(sessionsFor(result.current).discounts.applied?.code).toBe("FAST");
  });

  it("stops listening once the paywall unmounts", async () => {
    stubFetch(validation("SAVE10"));
    const { result, host, unmount, outgoing } = await mount();
    unmount();

    await act(async () => {
      host.send([{ event_name: "redeem_discount", code: "SAVE10" }]);
      await flush();
    });

    expect(sessionsFor(result.current).discounts.applied).toBeNull();
    expect(redemptions(outgoing)).toEqual([]);
  });
});
