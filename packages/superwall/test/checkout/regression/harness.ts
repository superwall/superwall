import { vi } from "vitest";
import type { SuperwallCheckoutConfig } from "@superwall/runtime";
import { purchaseEventsFor } from "../../../src/checkout/events";
import {
  applePayFor,
  elementsFor,
  lastWebFailure,
  purchaseOnWeb,
  purchaseWithElements,
  sessionsFor,
  watchCompletedCheckouts,
  type PaywallSession,
} from "../../../src/checkout/flow";
import { buildCheckoutSessionId } from "../../../src/checkout/session/id";
import type { ElementsCheckoutSession, WebPurchaseOptions } from "../../../src/checkout/types";

export type StripeResult = { error?: Record<string, unknown> } & Record<string, unknown>;

export const stripe = {
  results: new Map<string, StripeResult[]>(),
  calls: [] as { method: string; args: unknown[] }[],
  paymentRequest: vi.fn(() => wallet.paymentRequest),
};

const stripeMethod =
  (method: string) =>
  async (...args: unknown[]) => {
    stripe.calls.push({ method, args });
    const queued = stripe.results.get(method) ?? [];
    return queued.length > 1 ? queued.shift() : (queued[0] ?? {});
  };

for (const method of [
  "confirmPayment",
  "handleNextAction",
  "confirmCardPayment",
  "confirmCardSetup",
]) {
  Object.assign(stripe, { [method]: stripeMethod(method) });
}

export const wallet = {
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  paymentRequest: {} as Record<string, unknown>,
  completed: [] as string[],
};

export type Answer = { status?: number; body: unknown } | "network";

export type Backend = {
  confirm: Answer[];
  complete?: Answer;
  metadata?: Answer;
};

export const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const pathOf = (url: string) => new URL(url).pathname.replace(/^\/+/, "");

const answer = (found: Answer | undefined) => {
  if (found === undefined) return new Response("{}", { status: 200 });
  if (found === "network") throw new TypeError("Failed to fetch");
  return new Response(JSON.stringify(found.body), { status: found.status ?? 200 });
};

export const stubBackend = (backend: Backend) => {
  const requests: { path: string; body: unknown }[] = [];
  const confirms = [...backend.confirm];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = pathOf(url);
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path.endsWith("checkout/session/confirm")) {
        return answer(confirms.length > 1 ? confirms.shift() : confirms[0]);
      }
      if (path.endsWith("checkout/session/complete")) return answer(backend.complete);
      if (path.endsWith("checkout/session/custom-metadata")) return answer(backend.metadata);
      return answer(undefined);
    }),
  );
  return requests;
};

export const resetFakes = () => {
  stripe.results.clear();
  stripe.calls.length = 0;
  wallet.handlers.clear();
  wallet.completed.length = 0;
  wallet.paymentRequest = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      wallet.handlers.set(event, handler);
      return wallet.paymentRequest;
    }),
    canMakePayment: vi.fn().mockResolvedValue({ applePay: true }),
    show: vi.fn(),
  };
};

export const fakeSession = ({
  checkout = "applePay" as SuperwallCheckoutConfig,
  sdkVersionPadded = "004.020.000",
  postPurchase,
}: {
  checkout?: SuperwallCheckoutConfig;
  sdkVersionPadded?: string;
  postPurchase?: unknown;
} = {}) => {
  const products = [
    { reference: "primary", productId: "test:price_1:no-trial", variables: {}, source: "sdk" },
  ];
  const postMessage = vi.fn();
  const session: PaywallSession = {
    getSnapshot: () =>
      ({
        device: { publicApiKey: "pk_public", sdkVersionPadded },
        user: {},
        params: {},
        products,
        productsByReference: Object.fromEntries(products.map((p) => [p.reference, p])),
        introductoryOffer: { eligible: false },
        config: { checkout, ...(postPurchase === undefined ? {} : { postPurchase }) },
      }) as never,
    postMessage,
  };
  const messages = () =>
    postMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter((message) => message.event_name !== "stripe_checkout_diagnostic");
  return { session, messages };
};

export const quote = (
  overrides: Partial<ElementsCheckoutSession> = {},
): ElementsCheckoutSession => ({
  directive: "elements",
  checkoutSessionId: null,
  publishableKey: "pk_test",
  checkoutContextId: "ctx_1",
  referenceName: "primary",
  subscriptionDetails: { amount: 1999, currency: "usd", interval: "month", intervalCount: 1 },
  intentType: "PaymentIntent",
  ...overrides,
});

export const withSecret = (secret: string) =>
  buildCheckoutSessionId({ stripeCheckoutSessionId: secret, environment: "test" });

export type Path = "wallet" | "form";

export type Scenario = {
  quote: ElementsCheckoutSession;
  backend: Backend;
  stripe?: Record<string, StripeResult[]>;
  shopper?: "pay" | "cancel";
  options?: WebPurchaseOptions;
  sdkVersionPadded?: string;
  postPurchase?: unknown;
};

export type Run = {
  outcome: { status: string; failure?: { reason: string } };
  events: string[];
  messages: Record<string, unknown>[];
  requests: { path: string; body: unknown }[];
  stripeCalls: { method: string; args: unknown[] }[];
  walletCompleted: string[];
  lastFailure: unknown;
};

export const runPurchase = async (path: Path, scenario: Scenario): Promise<Run> => {
  resetFakes();
  for (const [method, results] of Object.entries(scenario.stripe ?? {})) {
    stripe.results.set(method, [...results]);
  }
  const requests = stubBackend(scenario.backend);
  const { session, messages } = fakeSession({
    checkout: path === "wallet" ? "applePay" : "elements",
    ...(scenario.sdkVersionPadded ? { sdkVersionPadded: scenario.sdkVersionPadded } : {}),
    ...(scenario.postPurchase === undefined ? {} : { postPurchase: scenario.postPurchase }),
  });
  const stopWatching = watchCompletedCheckouts(session);
  const events: string[] = [];
  const bus = purchaseEventsFor(session);
  const stops = (["start", "submit", "complete", "abandon", "failure"] as const).map((event) =>
    bus.on(event, () => events.push(event)),
  );
  const cancels = scenario.shopper === "cancel";

  let outcome: Run["outcome"];
  if (path === "wallet") {
    await applePayFor(session).prepare(scenario.quote);
    sessionsFor(session).cache.set("primary", scenario.quote, "elements");
    const pending = purchaseOnWeb(session, "primary", "applePay", scenario.options);
    await flush();
    if (cancels) wallet.handlers.get("cancel")?.();
    else {
      void wallet.handlers.get("paymentmethod")?.({
        paymentMethod: { id: "pm_1" },
        payerEmail: undefined,
        complete: (status: string) => wallet.completed.push(status),
      });
    }
    outcome = (await pending) as Run["outcome"];
  } else {
    await elementsFor(session).prepare(scenario.quote);
    outcome = (await purchaseWithElements(
      session,
      "primary",
      async () => (cancels ? null : { paymentMethodId: "pm_1" }),
      scenario.options,
    )) as Run["outcome"];
  }
  await flush();
  stops.forEach((stop) => stop());
  stopWatching();
  return {
    outcome,
    events,
    messages: messages(),
    requests,
    stripeCalls: [...stripe.calls],
    walletCompleted: [...wallet.completed],
    lastFailure: lastWebFailure(session),
  };
};
