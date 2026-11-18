import { afterEach, describe, expect, it, vi } from "vitest";
import { quote, runPurchase, stripe, type Run, type Scenario } from "./harness";
import { CASES } from "./scenarios";

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: vi.fn(async () => stripe) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const comparable = ({ walletCompleted: _wallet, ...run }: Run) => run;

const both = async (scenario: Scenario) => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const wallet = await runPurchase("wallet", scenario);
  const form = await runPurchase("form", scenario);
  return { wallet, form };
};

const OK = { body: { subscriptionId: "sub_1" } };

const OPTION_CASES: { name: string; scenario: Scenario; check: (run: Run) => void }[] = [
  {
    name: "Stripe metadata is attached to the checkout",
    scenario: {
      quote: quote(),
      backend: { confirm: [OK] },
      options: { stripeMetadata: { campaign: "spring", source: "paywall" } },
    },
    check: (run) =>
      expect(run.requests).toContainEqual({
        path: expect.stringContaining("checkout/session/custom-metadata"),
        body: expect.objectContaining({ metadata: { campaign: "spring", source: "paywall" } }),
      }),
  },
  {
    name: "postPurchase: stay resolves to the paywall",
    scenario: { quote: quote(), backend: { confirm: [OK] }, options: { postPurchase: "stay" } },
    check: (run) =>
      expect(run.messages.at(-1)).toMatchObject({
        event_name: "stripe_checkout_complete",
        post_purchase_resolution: { type: "paywall" },
      }),
  },
  {
    name: "postPurchase: a redirect carries its URL",
    scenario: {
      quote: quote(),
      backend: { confirm: [OK] },
      options: { postPurchase: { redirect: "https://example.com/welcome" } },
    },
    check: (run) =>
      expect(run.messages.at(-1)).toMatchObject({
        post_purchase_resolution: { type: "redirect", url: "https://example.com/welcome" },
      }),
  },
  {
    name: "the config's postPurchase applies when the call names none",
    scenario: { quote: quote(), backend: { confirm: [OK] }, postPurchase: "redeem" },
    check: (run) =>
      expect(run.messages.at(-1)).toMatchObject({ post_purchase_resolution: { type: "redeem" } }),
  },
  {
    name: "the quote's post-purchase behaviour reaches the SDK",
    scenario: { quote: quote({ postPurchaseBehavior: "REDIRECT" }), backend: { confirm: [OK] } },
    check: (run) =>
      expect(run.messages.at(-1)).toMatchObject({ post_purchase_behavior: "REDIRECT" }),
  },
  {
    name: "an SDK older than 4.14 gets a redemption link after the purchase",
    scenario: {
      quote: quote(),
      backend: { confirm: [OK], complete: { body: { redemptionUrl: "app://redeem/1" } } },
      sdkVersionPadded: "004.012.000",
    },
    check: (run) => {
      expect(run.messages.map((m) => m.event_name)).toEqual([
        "initiate_web_checkout",
        "stripe_checkout_start",
        "stripe_checkout_submit",
        "stripe_checkout_complete",
        "open_deep_link",
      ]);
      expect(run.messages.at(-1)).toMatchObject({ link: "app://redeem/1" });
    },
  },
  {
    name: "a current SDK redeems on its own and gets no link",
    scenario: {
      quote: quote(),
      backend: { confirm: [OK], complete: { body: { redemptionUrl: "app://redeem/1" } } },
    },
    check: (run) => {
      expect(run.messages.map((m) => m.event_name)).not.toContain("open_deep_link");
      expect(run.requests.map((r) => r.path)).not.toContain("checkout/session/complete");
    },
  },
  {
    name: "the wallet's payment method and the paywall's customer reach the backend",
    scenario: { quote: quote(), backend: { confirm: [OK] } },
    check: (run) =>
      expect(
        run.requests.find((r) => r.path.endsWith("checkout/session/confirm"))?.body,
      ).toMatchObject({ checkoutContextId: "ctx_1", paymentMethodId: "pm_1" }),
  },
];

describe("a form purchase reports exactly what an Apple Pay purchase does", () => {
  for (const { name, scenario } of CASES) {
    it(name, async () => {
      const { wallet, form } = await both(scenario);
      expect(comparable(form)).toEqual(comparable(wallet));
    });
  }

  for (const { name, scenario, check } of OPTION_CASES) {
    it(name, async () => {
      const { wallet, form } = await both(scenario);
      check(wallet);
      expect(comparable(form)).toEqual(comparable(wallet));
    });
  }
});
