import { quote, withSecret, type Scenario } from "./harness";

export type Expected = {
  status: "completed" | "abandoned" | "failed";
  reason?: string;
  events: string[];
  hostEvents: string[];
  stripe: string[];
  confirms: number;
  wallet: string[];
};

export type Case = { name: string; scenario: Scenario; expect: Expected };

const PAID = quote();
const TRIAL = quote({
  intentType: "SetupIntent",
  subscriptionDetails: {
    amount: 4999,
    amountDueNow: 0,
    currency: "usd",
    interval: "year",
    intervalCount: 1,
    trialPeriodDays: 7,
  },
});
const DISCOUNTED = quote({
  subscriptionDetails: {
    amount: 1999,
    discountedAmount: 999,
    amountDueNow: 999,
    currency: "eur",
    interval: "month",
    intervalCount: 1,
  },
});
const LEGACY_PAID = quote({ checkoutSessionId: withSecret("pi_1_secret_x") });
const LEGACY_TRIAL = quote({
  checkoutSessionId: withSecret("seti_1_secret_x"),
  intentType: "SetupIntent",
});

const OK = { body: { subscriptionId: "sub_1" } };
const COMPLETED = ["start", "submit", "complete"];
const COMPLETED_HOST = [
  "initiate_web_checkout",
  "stripe_checkout_start",
  "stripe_checkout_submit",
  "stripe_checkout_complete",
];
const FAILED = ["start", "submit", "failure"];
const FAILED_HOST = [
  "initiate_web_checkout",
  "stripe_checkout_start",
  "stripe_checkout_submit",
  "stripe_checkout_fail",
];
const completed = (stripe: string[], confirms: number): Expected => ({
  status: "completed",
  events: COMPLETED,
  hostEvents: COMPLETED_HOST,
  stripe,
  confirms,
  wallet: ["success"],
});

const deferredQuotes = { paid: PAID, trial: TRIAL, discounted: DISCOUNTED } as const;

const declineCodes: [string, Record<string, string>][] = [
  ["card_declined", { code: "card_declined" }],
  ["insufficient_funds", { code: "card_declined", decline_code: "insufficient_funds" }],
  ["expired_card", { code: "expired_card" }],
  ["incorrect_card_details", { code: "incorrect_cvc" }],
  ["authentication_failed", { code: "card_declined", decline_code: "authentication_required" }],
  ["fraud_suspected", { code: "card_declined", decline_code: "fraudulent" }],
  ["processing_error", { code: "processing_error" }],
];

export const CASES: Case[] = [
  ...Object.entries(deferredQuotes).flatMap(([kind, q]): Case[] => [
    {
      name: `${kind}: the backend confirms at once`,
      scenario: { quote: q, backend: { confirm: [OK] } },
      expect: completed([], 1),
    },
    {
      name: `${kind}: the shopper closes the wallet or backs out`,
      scenario: { quote: q, backend: { confirm: [OK] }, shopper: "cancel" },
      expect: {
        status: "abandoned",
        events: ["start", "abandon"],
        hostEvents: ["initiate_web_checkout", "stripe_checkout_start", "stripe_checkout_abandon"],
        stripe: [],
        confirms: 0,
        wallet: [],
      },
    },
    ...declineCodes.map(
      ([reason, failure]): Case => ({
        name: `${kind}: the backend declines with ${failure.decline_code ?? failure.code}`,
        scenario: {
          quote: q,
          backend: {
            confirm: [
              {
                status: 402,
                body: {
                  detail: "Declined",
                  failure: {
                    code: failure.code,
                    ...(failure.decline_code ? { declineCode: failure.decline_code } : {}),
                  },
                },
              },
            ],
          },
        },
        expect: {
          status: "failed",
          reason,
          events: FAILED,
          hostEvents: FAILED_HOST,
          stripe: [],
          confirms: 1,
          wallet: ["fail"],
        },
      }),
    ),
    {
      name: `${kind}: the backend refuses without naming a failure`,
      scenario: { quote: q, backend: { confirm: [{ status: 500, body: { detail: "Boom" } }] } },
      expect: {
        status: "failed",
        reason: "unknown",
        events: FAILED,
        hostEvents: FAILED_HOST,
        stripe: [],
        confirms: 1,
        wallet: ["fail"],
      },
    },
    {
      name: `${kind}: the confirm call never reaches the backend`,
      scenario: { quote: q, backend: { confirm: ["network"] } },
      expect: {
        status: "failed",
        reason: "unknown",
        events: FAILED,
        hostEvents: FAILED_HOST,
        stripe: [],
        confirms: 1,
        wallet: ["fail"],
      },
    },
  ]),

  {
    name: "paid: the bank asks for 3D Secure and the shopper passes it",
    scenario: {
      quote: PAID,
      backend: {
        confirm: [
          {
            body: {
              requiresAction: true,
              clientSecret: "pi_1_secret_x",
              intentType: "PaymentIntent",
              subscriptionId: "sub_1",
            },
          },
        ],
      },
      stripe: { confirmPayment: [{ paymentIntent: { status: "succeeded" } }] },
    },
    expect: completed(["confirmPayment"], 1),
  },
  ...declineCodes.map(
    ([reason, error]): Case => ({
      name: `paid: Stripe refuses the payment after the backend, with ${error.decline_code ?? error.code}`,
      scenario: {
        quote: PAID,
        backend: {
          confirm: [
            {
              body: {
                requiresAction: true,
                clientSecret: "pi_1_secret_x",
                intentType: "PaymentIntent",
              },
            },
          ],
        },
        stripe: { confirmPayment: [{ error: { type: "card_error", message: "No", ...error } }] },
      },
      expect: {
        status: "failed",
        reason,
        events: FAILED,
        hostEvents: FAILED_HOST,
        stripe: ["confirmPayment"],
        confirms: 1,
        wallet: ["success"],
      },
    }),
  ),
  {
    name: "paid: 3D Secure fails",
    scenario: {
      quote: PAID,
      backend: {
        confirm: [
          {
            body: {
              requiresAction: true,
              clientSecret: "pi_1_secret_x",
              intentType: "PaymentIntent",
            },
          },
        ],
      },
      stripe: {
        confirmPayment: [
          { error: { code: "payment_intent_authentication_failure", message: "3DS" } },
        ],
      },
    },
    expect: {
      status: "failed",
      reason: "authentication_failed",
      events: FAILED,
      hostEvents: FAILED_HOST,
      stripe: ["confirmPayment"],
      confirms: 1,
      wallet: ["success"],
    },
  },
  {
    name: "paid: the backend asks for action but sends no secret",
    scenario: { quote: PAID, backend: { confirm: [{ body: { requiresAction: true } }] } },
    expect: completed([], 1),
  },
  {
    name: "trial: the bank asks for 3D Secure on the setup and the shopper passes it",
    scenario: {
      quote: TRIAL,
      backend: {
        confirm: [
          {
            body: {
              requiresAction: true,
              clientSecret: "seti_1_secret_x",
              intentType: "SetupIntent",
              setupIntentId: "seti_1",
            },
          },
          OK,
        ],
      },
      stripe: { handleNextAction: [{ setupIntent: { id: "seti_1" } }] },
    },
    expect: completed(["handleNextAction"], 2),
  },
  {
    name: "trial: 3D Secure on the setup fails",
    scenario: {
      quote: TRIAL,
      backend: {
        confirm: [
          {
            body: {
              requiresAction: true,
              clientSecret: "seti_1_secret_x",
              intentType: "SetupIntent",
            },
          },
        ],
      },
      stripe: {
        handleNextAction: [
          { error: { code: "setup_intent_authentication_failure", message: "3DS" } },
        ],
      },
    },
    expect: {
      status: "failed",
      reason: "authentication_failed",
      events: FAILED,
      hostEvents: FAILED_HOST,
      stripe: ["handleNextAction"],
      confirms: 1,
      wallet: ["success"],
    },
  },
  {
    name: "trial: the setup authenticates into no SetupIntent anyone can name",
    scenario: {
      quote: TRIAL,
      backend: {
        confirm: [
          {
            body: {
              requiresAction: true,
              clientSecret: "seti_1_secret_x",
              intentType: "SetupIntent",
            },
          },
        ],
      },
      stripe: { handleNextAction: [{}] },
    },
    expect: {
      status: "failed",
      reason: "unknown",
      events: FAILED,
      hostEvents: FAILED_HOST,
      stripe: ["handleNextAction"],
      confirms: 1,
      wallet: ["success"],
    },
  },

  {
    name: "legacy paid quote: Stripe confirms the PaymentIntent it carries",
    scenario: {
      quote: LEGACY_PAID,
      backend: { confirm: [OK] },
      stripe: { confirmCardPayment: [{ paymentIntent: { status: "succeeded" } }] },
    },
    expect: completed(["confirmCardPayment"], 1),
  },
  {
    name: "legacy paid quote: 3D Secure, then success",
    scenario: {
      quote: LEGACY_PAID,
      backend: { confirm: [OK] },
      stripe: {
        confirmCardPayment: [
          { paymentIntent: { status: "requires_action" } },
          { paymentIntent: { status: "succeeded" } },
        ],
      },
    },
    expect: completed(["confirmCardPayment", "confirmCardPayment"], 1),
  },
  {
    name: "legacy paid quote: the card is declined for insufficient funds",
    scenario: {
      quote: LEGACY_PAID,
      backend: { confirm: [OK] },
      stripe: {
        confirmCardPayment: [
          { error: { code: "card_declined", decline_code: "insufficient_funds" } },
        ],
      },
    },
    expect: {
      status: "failed",
      reason: "insufficient_funds",
      events: FAILED,
      hostEvents: FAILED_HOST,
      stripe: ["confirmCardPayment"],
      confirms: 0,
      wallet: ["fail"],
    },
  },
  {
    name: "legacy paid quote: the money moved but the follow-up confirm fails",
    scenario: {
      quote: LEGACY_PAID,
      backend: { confirm: [{ status: 500, body: {} }] },
      stripe: { confirmCardPayment: [{ paymentIntent: { status: "succeeded" } }] },
    },
    expect: completed(["confirmCardPayment"], 1),
  },
  {
    name: "legacy trial quote: Stripe confirms the SetupIntent it carries",
    scenario: {
      quote: LEGACY_TRIAL,
      backend: { confirm: [OK] },
      stripe: { confirmCardSetup: [{ setupIntent: { id: "seti_1", status: "succeeded" } }] },
    },
    expect: completed(["confirmCardSetup"], 1),
  },
  {
    name: "legacy trial quote: 3D Secure on the setup, then success",
    scenario: {
      quote: LEGACY_TRIAL,
      backend: { confirm: [OK] },
      stripe: {
        confirmCardSetup: [
          { setupIntent: { id: "seti_1", status: "requires_action" } },
          { setupIntent: { id: "seti_1", status: "succeeded" } },
        ],
      },
    },
    expect: completed(["confirmCardSetup", "confirmCardSetup"], 1),
  },
  {
    name: "legacy trial quote: the card is declined",
    scenario: {
      quote: LEGACY_TRIAL,
      backend: { confirm: [OK] },
      stripe: { confirmCardSetup: [{ error: { code: "expired_card" } }] },
    },
    expect: {
      status: "failed",
      reason: "expired_card",
      events: FAILED,
      hostEvents: FAILED_HOST,
      stripe: ["confirmCardSetup"],
      confirms: 0,
      wallet: ["fail"],
    },
  },
];
