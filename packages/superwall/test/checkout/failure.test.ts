import { describe, expect, it } from "vitest";
import {
  CHECKOUT_FAILURE_REASONS,
  classifyStripeFailure,
  stripeFailure,
} from "../../src/checkout/failure";

describe("classifyStripeFailure", () => {
  it.each([
    ["card_declined", "insufficient_funds", "insufficient_funds"],
    ["card_declined", "generic_decline", "card_declined"],
    ["card_declined", "do_not_honor", "card_declined"],
    ["card_declined", "expired_card", "expired_card"],
    ["card_declined", "incorrect_cvc", "incorrect_card_details"],
    ["card_declined", "authentication_required", "authentication_failed"],
    ["card_declined", "card_not_supported", "card_not_supported"],
    ["card_declined", "card_velocity_exceeded", "limit_exceeded"],
    ["card_declined", "fraudulent", "fraud_suspected"],
    ["card_declined", "stolen_card", "fraud_suspected"],
    ["card_declined", "try_again_later", "processing_error"],
  ] as const)("reads %s with decline code %s as %s", (code, declineCode, reason) => {
    expect(classifyStripeFailure(code, declineCode)).toBe(reason);
  });

  it.each([
    ["card_declined", "card_declined"],
    ["expired_card", "expired_card"],
    ["incorrect_cvc", "incorrect_card_details"],
    ["incorrect_number", "incorrect_card_details"],
    ["incomplete_number", "incorrect_card_details"],
    ["invalid_expiry_year_past", "expired_card"],
    ["payment_intent_authentication_failure", "authentication_failed"],
    ["setup_intent_authentication_failure", "authentication_failed"],
    ["card_decline_rate_limit_exceeded", "limit_exceeded"],
    ["processing_error", "processing_error"],
    ["payment_method_unsupported_type", "card_not_supported"],
  ] as const)("reads code %s alone as %s", (code, reason) => {
    expect(classifyStripeFailure(code, undefined)).toBe(reason);
  });

  it("falls back to the code when the decline code is one it does not know", () => {
    expect(classifyStripeFailure("card_declined", "something_new")).toBe("card_declined");
  });

  it("stays unknown when nothing it knows was reported", () => {
    expect(classifyStripeFailure(undefined, undefined)).toBe("unknown");
    expect(classifyStripeFailure("api_key_expired", undefined)).toBe("unknown");
    expect(classifyStripeFailure("toString", "constructor")).toBe("unknown");
  });

  it("only returns reasons from the published list", () => {
    const reasons = new Set<string>(CHECKOUT_FAILURE_REASONS);
    for (const [code, declineCode] of [
      ["card_declined", "insufficient_funds"],
      ["expired_card", undefined],
      [undefined, undefined],
    ] as const) {
      expect(reasons.has(classifyStripeFailure(code, declineCode))).toBe(true);
    }
  });
});

describe("stripeFailure", () => {
  it("keeps the store's raw fields beside the reason", () => {
    expect(
      stripeFailure({
        code: "card_declined",
        declineCode: "insufficient_funds",
        message: "Your card has insufficient funds.",
      }),
    ).toEqual({
      reason: "insufficient_funds",
      store: "stripe",
      code: "card_declined",
      declineCode: "insufficient_funds",
      message: "Your card has insufficient funds.",
    });
  });

  it("leaves out the fields the store did not send", () => {
    expect(stripeFailure({})).toEqual({ reason: "unknown", store: "stripe" });
  });
});
