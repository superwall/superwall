import { afterEach, describe, expect, it, vi } from "vitest";
import { runPurchase, stripe } from "./harness";
import { CASES } from "./scenarios";

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: vi.fn(async () => stripe) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Apple Pay on the shared confirmation core", () => {
  for (const { name, scenario, expect: want } of CASES) {
    it(name, async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const run = await runPurchase("wallet", scenario);

      expect(run.outcome.status).toBe(want.status);
      if (want.reason) expect(run.outcome.failure?.reason).toBe(want.reason);
      expect(run.events).toEqual(want.events);
      expect(run.messages.map((message) => message.event_name)).toEqual(want.hostEvents);
      expect(run.stripeCalls.map((call) => call.method)).toEqual(want.stripe);
      expect(run.requests.filter((r) => r.path.endsWith("checkout/session/confirm"))).toHaveLength(
        want.confirms,
      );
      expect(run.walletCompleted).toEqual(want.wallet);
      for (const message of run.messages) {
        expect(message).toMatchObject({
          checkout_context_id: "ctx_1",
          product_identifier: "test:price_1:no-trial",
        });
      }
      if (want.status === "failed") {
        expect(run.lastFailure).toMatchObject({
          referenceName: "primary",
          failure: { reason: want.reason },
        });
      }
    });
  }
});
