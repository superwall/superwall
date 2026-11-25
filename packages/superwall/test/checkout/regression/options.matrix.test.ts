import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elementsOptionsOf,
  type StripeCheckoutOptions,
} from "../../../src/checkout/elements/StripeCheckout";
import { quote } from "./harness";

type Expected = { currency: string; mode: "subscription" | "setup"; amount?: number };

const QUOTES = {
  "a paid USD month": quote(),
  "a free-trial EUR year": quote({
    intentType: "SetupIntent",
    subscriptionDetails: {
      amount: 4999,
      amountDueNow: 0,
      currency: "EUR",
      interval: "year",
      intervalCount: 1,
      trialPeriodDays: 7,
    },
  }),
  "a discounted GBP quarter": quote({
    subscriptionDetails: {
      amount: 2999,
      discountedAmount: 1499,
      currency: "gbp",
      interval: "month",
      intervalCount: 3,
    },
  }),
  "a zero-decimal JPY week": quote({
    subscriptionDetails: { amount: 500, currency: "JPY", interval: "week", intervalCount: 1 },
  }),
  "a trial the backend names no intent for": quote({
    intentType: undefined,
    subscriptionDetails: {
      amount: 999,
      amountDueNow: 0,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
    },
  }),
};

const OPTIONS: Record<string, StripeCheckoutOptions> = {
  "no options": {},
  "an appearance": { appearance: { theme: "night", variables: { colorPrimary: "#46d7d4" } } },
  "a locale and fonts": { locale: "de", fonts: [{ cssSrc: "https://fonts.example/a.css" }] },
  "cards only": { paymentMethodTypes: ["card"] },
  "cards and Link only": { paymentMethodTypes: ["card", "link"] },
  "bank debits mixed in": { paymentMethodTypes: ["card", "us_bank_account", "link", "ideal"] },
  "the price fields the types forbid": {
    mode: "payment",
    amount: 1,
    currency: "xxx",
    paymentMethodCreation: "auto",
    setupFutureUsage: "on_session",
  } as unknown as StripeCheckoutOptions,
};

const EXPECTED: Record<keyof typeof QUOTES, Expected> = {
  "a paid USD month": { currency: "usd", mode: "subscription", amount: 1999 },
  "a free-trial EUR year": { currency: "eur", mode: "setup" },
  "a discounted GBP quarter": { currency: "gbp", mode: "subscription", amount: 1499 },
  "a zero-decimal JPY week": { currency: "jpy", mode: "subscription", amount: 500 },
  "a trial the backend names no intent for": { currency: "usd", mode: "setup" },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Stripe's options for every price and every option set", () => {
  for (const [priceName, priced] of Object.entries(QUOTES)) {
    for (const [optionsName, options] of Object.entries(OPTIONS)) {
      it(`${priceName}, with ${optionsName}`, () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const built = elementsOptionsOf(priced, options) as unknown as Record<string, unknown>;
        const expected = EXPECTED[priceName as keyof typeof QUOTES];

        expect(built.currency).toBe(expected.currency);
        expect(built.mode).toBe(expected.mode);
        expect(built.paymentMethodCreation).toBe("manual");
        if (expected.mode === "setup") {
          expect(built.setupFutureUsage).toBe("off_session");
          expect(built).not.toHaveProperty("amount");
        } else {
          expect(built.amount).toBe(expected.amount);
          expect(built).not.toHaveProperty("setupFutureUsage");
        }
        const asked = (options as { paymentMethodTypes?: string[] }).paymentMethodTypes;
        const supported = asked?.filter((type) => type === "card" || type === "link");
        expect(built.paymentMethodTypes).toEqual(supported?.length ? supported : ["card", "link"]);
        for (const key of ["appearance", "locale", "fonts"] as const) {
          if (key in options) expect(built[key]).toEqual(options[key]);
        }
      });
    }
  }
});
