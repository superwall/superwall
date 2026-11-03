import { loadStripe, type Stripe, type StripeEmbeddedCheckout } from "@stripe/stripe-js";
import type { EmbeddedCheckoutSession } from "../types";

export type EmbeddedHandlers = {
  onComplete: () => void;
  onAnalyticsEvent: (event: { eventType: string }) => void;
  onError: (error: Error) => void;
};

export type EmbeddedRequest = {
  session: Pick<EmbeddedCheckoutSession, "clientSecret" | "publishableKey">;
  element: HTMLElement;
  handlers: { readonly current: EmbeddedHandlers };
};

type LoadStripe = (publishableKey: string) => Promise<Stripe | null>;

const errorOf = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const destroy = (checkout: StripeEmbeddedCheckout) => {
  try {
    checkout.destroy();
  } catch (error) {
    console.error("[checkout] destroying Stripe's embedded checkout failed:", error);
  }
};

export const createEmbeddedCheckouts = (load: LoadStripe) => {
  const stripeByKey = new Map<string, Promise<Stripe | null>>();
  let desired: EmbeddedRequest | null = null;
  let attempted: EmbeddedRequest | null = null;
  let live: { request: EmbeddedRequest; checkout: StripeEmbeddedCheckout } | null = null;
  let running = false;

  const stripeFor = (publishableKey: string): Promise<Stripe | null> => {
    const cached = stripeByKey.get(publishableKey);
    if (cached) return cached;
    const loaded = load(publishableKey);
    stripeByKey.set(publishableKey, loaded);
    loaded.catch(() => stripeByKey.delete(publishableKey));
    return loaded;
  };

  const start = async (request: EmbeddedRequest): Promise<StripeEmbeddedCheckout | null> => {
    try {
      const stripe = await stripeFor(request.session.publishableKey);
      if (!stripe) throw new Error("Stripe.js did not load");
      if (desired !== request) return null;
      const checkout = await stripe.initEmbeddedCheckout({
        clientSecret: request.session.clientSecret,
        onComplete: () => request.handlers.current.onComplete(),
        onAnalyticsEvent: (event) => request.handlers.current.onAnalyticsEvent(event),
      });
      if (desired !== request) return checkout;
      try {
        checkout.mount(request.element);
      } catch (error) {
        destroy(checkout);
        throw error;
      }
      return checkout;
    } catch (error) {
      request.handlers.current.onError(errorOf(error));
      return null;
    }
  };

  const settle = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        if (live && live.request !== desired) {
          const { checkout } = live;
          live = null;
          destroy(checkout);
          continue;
        }
        if (!desired || live || attempted === desired) break;
        const request = desired;
        attempted = request;
        const checkout = await start(request);
        if (checkout) live = { request, checkout };
      }
    } finally {
      running = false;
    }
  };

  return {
    show: (request: EmbeddedRequest): (() => void) => {
      desired = request;
      void settle();
      return () => {
        if (desired !== request) return;
        desired = null;
        void settle();
      };
    },
  };
};

export const embeddedCheckouts = createEmbeddedCheckouts((publishableKey) =>
  loadStripe(publishableKey, { developerTools: { assistant: { enabled: false } } }),
);
