import { describe, expect, it } from "vitest";
import {
  asNumber,
  asString,
  errorMessageOf,
  field,
  intentTypeOf,
  readAppliedDiscount,
  readCheckoutSession,
  readCheckoutStatus,
  readDiscountValidation,
  readDiscountedPrice,
  readSubscriptionDetails,
} from "../../../src/checkout/api/decode";

const SECRET = "cs_test_abc";
const SW_ID = `sw_checkout_${btoa(
  JSON.stringify({ provider: "stripe", env: "test", stripeCheckoutSessionId: SECRET }),
)}`;

const discount = { code: "SAVE5", promotionCodeId: "promo_1", couponId: "c_1" };

describe("readAppliedDiscount", () => {
  it("needs the code and both Stripe ids", () => {
    expect(readAppliedDiscount({ code: "SAVE5", promotionCodeId: "promo_1" })).toBeNull();
    expect(readAppliedDiscount("SAVE5")).toBeNull();
  });

  it("keeps nullable fields as null and drops what was never sent", () => {
    expect(readAppliedDiscount(discount)).toEqual({
      ...discount,
      name: null,
      percentOff: null,
      amountOff: null,
      currency: null,
      durationInMonths: null,
    });
  });

  it("reads every field the backend can send", () => {
    expect(
      readAppliedDiscount({
        ...discount,
        name: "Five off",
        percentOff: 10,
        amountOff: 500,
        currency: "usd",
        duration: "repeating",
        durationInMonths: 3,
        firstTimeTransactionOnly: true,
      }),
    ).toEqual({
      ...discount,
      name: "Five off",
      percentOff: 10,
      amountOff: 500,
      currency: "usd",
      duration: "repeating",
      durationInMonths: 3,
      firstTimeTransactionOnly: true,
    });
    expect(readAppliedDiscount({ ...discount, duration: "weekly" })?.duration).toBeUndefined();
  });
});

describe("readDiscountedPrice", () => {
  it("needs a product identifier and a currency", () => {
    expect(readDiscountedPrice({ productIdentifier: "p" })).toBeNull();
    expect(readDiscountedPrice({ currency: "usd" })).toBeNull();
  });

  it("defaults the amounts and reads the optional period", () => {
    expect(readDiscountedPrice({ productIdentifier: "p", currency: "usd" })).toEqual({
      productIdentifier: "p",
      applies: false,
      originalAmount: 0,
      discountedAmount: 0,
      currency: "usd",
    });
    expect(
      readDiscountedPrice({
        productIdentifier: "p",
        currency: "usd",
        applies: true,
        originalAmount: 1999,
        discountedAmount: 1499,
        interval: "month",
        intervalCount: 1,
        productName: "Pro",
      }),
    ).toEqual({
      productIdentifier: "p",
      applies: true,
      originalAmount: 1999,
      discountedAmount: 1499,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      productName: "Pro",
    });
  });
});

describe("readDiscountValidation", () => {
  it("passes the backend's reason through, with a fallback when it gives none", () => {
    expect(readDiscountValidation({ valid: false, reason: "code_not_found" })).toEqual({
      valid: false,
      reason: "code_not_found",
    });
    expect(readDiscountValidation({ valid: false })).toEqual({
      valid: false,
      reason: "invalid_code",
    });
    expect(readDiscountValidation(null)).toEqual({ valid: false, reason: "invalid_code" });
  });

  it("rejects a valid verdict without a usable discount", () => {
    expect(readDiscountValidation({ valid: true, discount: {} })).toEqual({
      valid: false,
      reason: "malformed_discount",
    });
  });

  it("keeps only the prices it can read", () => {
    expect(
      readDiscountValidation({
        valid: true,
        discount,
        products: [{ productIdentifier: "p", currency: "usd" }, { nope: true }],
      }),
    ).toMatchObject({ valid: true, products: [{ productIdentifier: "p" }] });
    expect(readDiscountValidation({ valid: true, discount, products: "none" })).toMatchObject({
      valid: true,
      products: [],
    });
  });
});

describe("readSubscriptionDetails", () => {
  it("needs a currency and a known interval", () => {
    expect(readSubscriptionDetails({ currency: "usd", interval: "fortnight" })).toBeNull();
    expect(readSubscriptionDetails({ interval: "month" })).toBeNull();
  });

  it("defaults the amount and count and drops missing optionals", () => {
    expect(
      readSubscriptionDetails({ currency: "usd", interval: "week", intervalCount: 0 }),
    ).toEqual({ amount: 0, currency: "usd", interval: "week", intervalCount: 1 });
  });

  it("reads the trial, name and nested discount", () => {
    expect(
      readSubscriptionDetails({
        amount: 1999,
        amountDueNow: 0,
        currency: "usd",
        interval: "month",
        intervalCount: 1,
        trialPeriodDays: 7,
        productName: "Pro",
        discountedAmount: 1499,
        discount: { ...discount, duration: "forever" },
      }),
    ).toMatchObject({
      amount: 1999,
      amountDueNow: 0,
      trialPeriodDays: 7,
      productName: "Pro",
      discountedAmount: 1499,
      discount: { code: "SAVE5", duration: "forever" },
    });
  });
});

const body = (extra: Record<string, unknown>) => ({
  checkoutContextId: "ctx",
  directive: { directive: "embedded", publishableKey: "pk", ...extra },
});

describe("readCheckoutSession", () => {
  it("carries the post-purchase behaviour the backend resolved", () => {
    expect(
      readCheckoutSession(
        {
          checkoutContextId: "ctx",
          postPurchaseBehavior: "REDIRECT",
          directive: {
            directive: "embedded",
            checkoutSessionId: "cs",
            publishableKey: "pk",
          },
        },
        "monthly",
        false,
      ),
    ).toMatchObject({ postPurchaseBehavior: "REDIRECT" });
    expect(
      readCheckoutSession(
        {
          checkoutContextId: "ctx",
          postPurchaseBehavior: "SOMETHING_ELSE",
          directive: {
            directive: "embedded",
            checkoutSessionId: "cs",
            publishableKey: "pk",
          },
        },
        "monthly",
        false,
      ),
    ).not.toHaveProperty("postPurchaseBehavior");
  });

  it("reads an elements quote with its optional Stripe facts", () => {
    expect(
      readCheckoutSession(
        {
          checkoutContextId: "ctx",
          directive: {
            directive: "elements",
            checkoutSessionId: SW_ID,
            publishableKey: "pk",
            subscriptionDetails: { currency: "usd", interval: "month" },
            intentType: "SetupIntent",
            stripeAccountCountryCode: "US",
            managementUrl: "https://x/manage",
          },
        },
        "monthly",
        true,
      ),
    ).toEqual({
      directive: "elements",
      checkoutSessionId: SW_ID,
      publishableKey: "pk",
      checkoutContextId: "ctx",
      referenceName: "monthly",
      subscriptionDetails: { amount: 0, currency: "usd", interval: "month", intervalCount: 1 },
      intentType: "SetupIntent",
      stripeAccountCountryCode: "US",
      managementUrl: "https://x/manage",
      wasPrefetched: true,
    });
  });

  it("rejects an elements quote the wallet cannot price", () => {
    expect(() =>
      readCheckoutSession(
        { checkoutContextId: "ctx", directive: { directive: "elements", publishableKey: "pk" } },
        "monthly",
        false,
      ),
    ).toThrow(/subscriptionDetails/);
  });

  it("derives the embedded client secret from the session id when Stripe omits it", () => {
    expect(readCheckoutSession(body({ checkoutSessionId: SW_ID }), "m", false)).toMatchObject({
      directive: "embedded",
      clientSecret: SECRET,
    });
    expect(
      readCheckoutSession(body({ checkoutSessionId: SW_ID, clientSecret: "given" }), "m", false),
    ).toMatchObject({ clientSecret: "given" });
    expect(readCheckoutSession(body({ checkoutSessionId: "plain" }), "m", false)).toMatchObject({
      clientSecret: "plain",
    });
    expect(() => readCheckoutSession(body({}), "m", false)).toThrow(/checkoutSessionId/);
  });

  it("reads a redirect and refuses one without a destination", () => {
    expect(
      readCheckoutSession(
        {
          checkoutContextId: "ctx",
          directive: { directive: "redirect", checkoutSessionId: "cs", checkoutUrl: "https://x" },
        },
        "m",
        false,
      ),
    ).toEqual({
      directive: "redirect",
      checkoutSessionId: "cs",
      checkoutUrl: "https://x",
      checkoutContextId: "ctx",
      referenceName: "m",
    });
    expect(() =>
      readCheckoutSession(
        { checkoutContextId: "ctx", directive: { directive: "redirect", checkoutSessionId: "cs" } },
        "m",
        false,
      ),
    ).toThrow(/checkoutUrl/);
  });

  it("refuses a directive it does not know", () => {
    expect(() => readCheckoutSession({ directive: { directive: "nope" } }, "m", false)).toThrow(
      "Invalid checkout session directive: nope",
    );
    expect(() => readCheckoutSession("junk", "m", false)).toThrow(/Invalid checkout session/);
  });
});

describe("errorMessageOf", () => {
  it("prefers the nested error message, then the flat fields, then the fallback", () => {
    expect(errorMessageOf({ error: { message: "nested" }, message: "flat" }, "f")).toBe("nested");
    expect(errorMessageOf({ message: "flat" }, "f")).toBe("flat");
    expect(errorMessageOf({ detail: "detail" }, "f")).toBe("detail");
    expect(errorMessageOf({ title: "title" }, "f")).toBe("title");
    expect(errorMessageOf({ error: "plain", message: 1 }, "f")).toBe("f");
    expect(errorMessageOf(null, "f")).toBe("f");
  });
});

describe("intentTypeOf", () => {
  it("accepts only Stripe's two intent kinds", () => {
    expect(intentTypeOf("PaymentIntent")).toBe("PaymentIntent");
    expect(intentTypeOf("SetupIntent")).toBe("SetupIntent");
    expect(intentTypeOf("Other")).toBeUndefined();
  });
});

describe("field, asString and asNumber", () => {
  it("read what the wire sent, and nothing from what it did not", () => {
    expect(field({ a: 1 }, "a")).toBe(1);
    expect(field(null, "a")).toBeUndefined();
    expect(field("string", "a")).toBeUndefined();

    expect(asString("x")).toBe("x");
    expect(asString(undefined)).toBe("");
    expect(asString(null)).toBe("");
    expect(asString(12)).toBe("12");

    expect(asNumber("19.99")).toBe(19.99);
    expect(asNumber("nope")).toBe(0);
    expect(asNumber(undefined)).toBe(0);
  });
});

describe("readCheckoutSession without Stripe's optional facts", () => {
  it("leaves out the intent type, country and management URL", () => {
    expect(
      readCheckoutSession(
        {
          checkoutContextId: "ctx",
          directive: {
            directive: "elements",
            publishableKey: "pk",
            subscriptionDetails: { currency: "usd", interval: "year" },
            intentType: "Other",
            stripeAccountCountryCode: 44,
            managementUrl: null,
          },
        },
        "yearly",
        false,
      ),
    ).toEqual({
      directive: "elements",
      checkoutSessionId: null,
      publishableKey: "pk",
      checkoutContextId: "ctx",
      referenceName: "yearly",
      subscriptionDetails: { amount: 0, currency: "usd", interval: "year", intervalCount: 1 },
    });
  });
});

describe("readCheckoutStatus", () => {
  it("reads a status the backend knows, with its redemption link", () => {
    expect(readCheckoutStatus({ status: "completed", redemptionUrl: "myapp://redeem" })).toEqual({
      status: "completed",
      redemptionUrl: "myapp://redeem",
    });
    expect(readCheckoutStatus({ status: "abandoned" })).toEqual({ status: "abandoned" });
  });

  it("treats anything it cannot read as still pending, with no link", () => {
    expect(readCheckoutStatus({ status: "who knows" })).toEqual({ status: "pending" });
    expect(readCheckoutStatus(null)).toEqual({ status: "pending" });
    expect(readCheckoutStatus({ status: "completed", redemptionUrl: "" })).toEqual({
      status: "completed",
    });
    expect(readCheckoutStatus({ status: "completed", redemptionUrl: 7 })).toEqual({
      status: "completed",
    });
  });
});
