import { afterEach, describe, expect, it, vi } from "vitest";
import {
  amountsOf,
  elementsOptionsOf,
  type StripeCheckoutOptions,
} from "../../../src/checkout/elements/StripeCheckout";
import { quote } from "./harness";

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Stripe's options for every price and every option set", () => {
  for (const [priceName, priced] of Object.entries(QUOTES)) {
    for (const [optionsName, options] of Object.entries(OPTIONS)) {
      it(`${priceName}, with ${optionsName}`, () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const built = elementsOptionsOf(priced, options) as unknown as Record<string, unknown>;
        const { currency, dueNow } = amountsOf(priced);
        const free = dueNow === 0;

        expect(built.currency).toBe(priced.subscriptionDetails.currency.toLowerCase());
        expect(built.paymentMethodCreation).toBe("manual");
        if (free) {
          expect(built.mode).toBe("setup");
          expect(built.setupFutureUsage).toBe("off_session");
          expect(built).not.toHaveProperty("amount");
        } else {
          expect(built.mode).toBe("subscription");
          expect(built.amount).toBe(dueNow);
          expect(built).not.toHaveProperty("setupFutureUsage");
        }
        const asked = (options as { paymentMethodTypes?: string[] }).paymentMethodTypes;
        const supported = asked?.filter((type) => type === "card" || type === "link");
        expect(built.paymentMethodTypes).toEqual(supported?.length ? supported : ["card", "link"]);
        for (const key of ["appearance", "locale", "fonts"] as const) {
          if (key in options) expect(built[key]).toEqual(options[key]);
        }
        expect(currency).toBe(built.currency);
      });
    }
  }
});
