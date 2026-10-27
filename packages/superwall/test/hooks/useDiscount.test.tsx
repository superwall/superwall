import { act } from "@testing-library/react";
import type { TOutgoingMessage } from "@superwall/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDiscount, useSuperwallSession } from "../../src/hooks";
import { sessionsFor } from "../../src/checkout/flow";
import { checkoutEvents } from "../../src/checkout/events";
import { flush, renderWithProvider, testConfig } from "../helpers";

const products = [
  { reference: "primary", productId: "test:price_1:no-trial" },
  { reference: "secondary", productId: "stripe|test:price_2:no-trial" },
  { reference: "store", productId: "pro_999_month" },
];

const validation = {
  valid: true,
  discount: {
    code: "SAVE5",
    promotionCodeId: "promo_1",
    couponId: "c_1",
    amountOff: 500,
    currency: "usd",
    duration: "once",
  },
  products: [
    {
      productIdentifier: "test:price_1:no-trial",
      applies: true,
      originalAmount: 1999,
      discountedAmount: 1499,
      currency: "usd",
    },
    {
      productIdentifier: "test:price_2:no-trial",
      applies: false,
      originalAmount: 999,
      discountedAmount: 999,
      currency: "usd",
    },
  ],
};

const embedded = {
  checkoutContextId: "ctx_1",
  directive: {
    directive: "embedded",
    checkoutSessionId: "sw_checkout_1",
    publishableKey: "pk_test",
    clientSecret: "cs_secret",
  },
};

const stubFetch = (discount: unknown = validation) => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url.includes("checkout/discount")
      ? new Response(JSON.stringify(discount), { status: 200 })
      : new Response(JSON.stringify(embedded), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const renderDiscount = async (
  onDropped?: (code: string) => void,
  onOutgoing?: (message: TOutgoingMessage) => void,
) => {
  const rendered = renderWithProvider(
    () => ({ session: useSuperwallSession(), discount: useDiscount({ onDropped }) }),
    {
      config: { ...testConfig, checkout: "applePay" },
      // The mock host ships no public API key; checkout warm-ups need one.
      host: { products, device: { platform: "Android", publicApiKey: "pk_test" }, onOutgoing },
    },
  );
  await flush();
  return rendered;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDiscount", () => {
  it("starts with nothing applied", async () => {
    stubFetch();
    const { result } = await renderDiscount();
    expect(result.current.discount.applied).toBeNull();
    expect(result.current.discount.isRedeeming).toBe(false);
  });

  it("redeems a code and exposes per-product prices by reference", async () => {
    stubFetch();
    const { result } = await renderDiscount();
    const invalidated = vi.fn();
    const off = checkoutEvents.subscribe("SESSION_INVALIDATED", invalidated);

    let redemption: Awaited<ReturnType<typeof result.current.discount.redeem>> | undefined;
    await act(async () => {
      redemption = await result.current.discount.redeem("SAVE5");
    });
    off();

    expect(redemption).toMatchObject({
      valid: true,
      code: "SAVE5",
      products: {
        primary: {
          applies: true,
          price: "$19.99",
          discountedPrice: "$14.99",
          discountedAmount: 1499,
        },
        secondary: { applies: false, discountedPrice: "$9.99" },
      },
    });
    expect(result.current.discount.applied?.code).toBe("SAVE5");
    expect(result.current.discount.getDiscountedProduct("primary")?.discountedPrice).toBe("$14.99");
    expect(result.current.discount.getDiscountedProduct("store")).toBeUndefined();
    expect(invalidated).toHaveBeenCalledWith({ reason: "discount code redeemed" });
  });

  it("re-warms checkout with the code so the wallet quotes the discount", async () => {
    const fetchMock = stubFetch();
    const { result } = await renderDiscount();
    await act(async () => {
      await result.current.discount.redeem("SAVE5");
      await flush();
    });
    const warmups = fetchMock.mock.calls
      .filter(([url]) => url.includes("checkout/session"))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
    const withCode = warmups.filter((body) => body.promotionCode === "SAVE5");
    expect(withCode.map((body) => body.productIdentifier)).toEqual(["test:price_1:no-trial"]);
    expect(
      warmups.find((body) => body.productIdentifier === "test:price_2:no-trial")?.promotionCode,
    ).toBeUndefined();
  });

  it("hands back Stripe's coupon, so the paywall writes its own sentence", async () => {
    stubFetch();
    const { result } = await renderDiscount();
    await act(async () => {
      await result.current.discount.redeem("SAVE5");
    });

    // $5 off, once — enough to write "$5 off your first month" without this
    // hook ever choosing a language.
    expect(result.current.discount.applied?.discount).toMatchObject({
      code: "SAVE5",
      amountOff: 500,
      currency: "usd",
      duration: "once",
      percentOff: null,
    });
    expect(result.current.discount.getDiscountedProduct("primary")).toMatchObject({
      amount: 1999,
      discountedAmount: 1499,
      savings: 500,
      savingsPrice: "$5",
    });
  });

  it("keeps a percent coupon's own fields, and prices what it saves", async () => {
    stubFetch({
      valid: true,
      discount: {
        code: "FOREVER15",
        promotionCodeId: "promo_2",
        couponId: "c_2",
        percentOff: 15,
        duration: "repeating",
        durationInMonths: 3,
      },
      products: [
        {
          productIdentifier: "test:price_1:no-trial",
          applies: true,
          originalAmount: 1999,
          discountedAmount: 1699,
          currency: "usd",
        },
      ],
    });
    const { result } = await renderDiscount();
    await act(async () => {
      await result.current.discount.redeem("FOREVER15");
    });

    expect(result.current.discount.applied?.discount).toMatchObject({
      percentOff: 15,
      duration: "repeating",
      durationInMonths: 3,
    });
    expect(result.current.discount.getDiscountedProduct("primary")).toMatchObject({
      savings: 300,
      savingsPrice: "$3",
    });
  });

  it("takes the saving from the priced amounts, not the coupon", async () => {
    // An amount coupon larger than the price cannot save more than the price.
    stubFetch({
      valid: true,
      discount: {
        code: "BIG",
        promotionCodeId: "promo_3",
        couponId: "c_3",
        amountOff: 5000,
        duration: "once",
      },
      products: [
        {
          productIdentifier: "test:price_1:no-trial",
          applies: true,
          originalAmount: 1999,
          discountedAmount: 0,
          currency: "usd",
        },
      ],
    });
    const { result } = await renderDiscount();
    await act(async () => {
      await result.current.discount.redeem("BIG");
    });

    expect(result.current.discount.getDiscountedProduct("primary")?.savings).toBe(1999);
    expect(result.current.discount.applied?.discount.amountOff).toBe(5000);
  });

  it("resolves with the reason when a code is not valid", async () => {
    stubFetch({ valid: false, reason: "code_not_found" });
    const { result } = await renderDiscount();
    let redemption: unknown;
    await act(async () => {
      redemption = await result.current.discount.redeem("NOPE");
    });
    expect(redemption).toEqual({ valid: false, reason: "code_not_found" });
    expect(result.current.discount.applied).toBeNull();
  });

  it("never throws when the backend is unreachable, and says so to the host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const posted: TOutgoingMessage[] = [];
    const { result } = await renderDiscount(undefined, (message) => posted.push(message));
    let redemption: unknown;
    await act(async () => {
      redemption = await result.current.discount.redeem("SAVE5");
    });

    expect(redemption).toEqual({ valid: false, reason: "error" });
    expect(posted.filter((message) => message.event_name === "discount_redemption_result")).toEqual(
      [{ event_name: "discount_redemption_result", code: "SAVE5", valid: false, reason: "error" }],
    );
    expect(error).toHaveBeenCalledWith("Error redeeming a promotion code:", expect.any(Error));
  });

  it("clears the code and the sessions quoted with it", async () => {
    stubFetch();
    const { result } = await renderDiscount();
    await act(async () => {
      await result.current.discount.redeem("SAVE5");
    });
    const invalidated = vi.fn();
    const off = checkoutEvents.subscribe("SESSION_INVALIDATED", invalidated);
    act(() => {
      result.current.discount.clear();
    });
    off();
    expect(result.current.discount.applied).toBeNull();
    expect(invalidated).toHaveBeenCalledWith({ reason: "discount code cleared" });
  });

  it("calls onDropped and forgets the code when checkout refuses it", async () => {
    stubFetch();
    const onDropped = vi.fn();
    const { result } = await renderDiscount(onDropped);
    await act(async () => {
      await result.current.discount.redeem("SAVE5");
    });
    const sessions = sessionsFor(result.current.session);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("refused", { status: 400 })),
    );

    await act(async () => {
      await sessions.begin({ referenceName: "primary", mode: "sheet" }).catch(() => {});
    });

    expect(onDropped).toHaveBeenCalledWith("SAVE5");
    expect(result.current.discount.applied).toBeNull();
  });
});

describe("useDiscount without a listener or a code", () => {
  it("drops a code with no onDropped to tell, and clears nothing when nothing is applied", async () => {
    stubFetch();
    const { result } = await renderDiscount();
    const sessions = sessionsFor(result.current.session);

    act(() => {
      result.current.discount.clear();
    });
    expect(result.current.discount.applied).toBeNull();

    await act(async () => {
      await result.current.discount.redeem("SAVE5");
    });
    act(() => {
      sessions.discounts.drop("SAVE5");
    });
    expect(result.current.discount.applied).toBeNull();
  });

  it("prices only the products the backend named", async () => {
    stubFetch({
      valid: true,
      discount: { code: "SAVE5", promotionCodeId: "promo_1", couponId: "c_1", percentOff: 10 },
      products: [
        {
          productIdentifier: "test:price_9:no-trial",
          applies: true,
          originalAmount: 1999,
          discountedAmount: 1799,
          currency: "usd",
        },
      ],
    });
    const { result } = await renderDiscount();
    await act(async () => {
      await result.current.discount.redeem("SAVE5");
    });
    expect(result.current.discount.applied?.products).toEqual({});
  });
});
