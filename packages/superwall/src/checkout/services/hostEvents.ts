import type { SuperwallSession } from "@superwall/runtime";

type HostMessage = Parameters<SuperwallSession["postMessage"]>[0];

/**
 * What the native SDK needs to attribute a web checkout: the sealed context
 * id and the store product identifier, plus the presentation facts it turns
 * into `transaction_start`.
 */
export type CheckoutHostContext = {
  checkoutContextId: string;
  productIdentifier: string;
  paywallIdentifier?: string;
  experimentVariantId?: string;
  presentedByEventName?: string;
};

/**
 * The web checkout lifecycle as the native SDK hears it. One message per
 * step, in the SDK's vocabulary, so the Apple Pay sheet and Stripe's
 * embedded sheet report identically and the SDK can track, dismiss, and
 * grant access the same way for both.
 */
export type CheckoutHostEvents = ReturnType<typeof checkoutHostEvents>;

export const checkoutHostEvents = (post: (message: HostMessage) => void) => ({
  prefetched: (ctx: CheckoutHostContext) =>
    post({
      event_name: "stripe_checkout_prefetch",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    }),
  initiated: (ctx: CheckoutHostContext) => {
    post({
      event_name: "initiate_web_checkout",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
      paywall_identifier: ctx.paywallIdentifier,
      experiment_variant_id: ctx.experimentVariantId,
      presented_by_event_name: ctx.presentedByEventName,
      store: "STRIPE",
    });
    post({
      event_name: "stripe_checkout_start",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    });
  },
  submitted: (ctx: CheckoutHostContext) =>
    post({
      event_name: "stripe_checkout_submit",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    }),
  abandoned: (ctx: CheckoutHostContext) =>
    post({
      event_name: "stripe_checkout_abandon",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    }),
  failed: (ctx: CheckoutHostContext) =>
    post({
      event_name: "stripe_checkout_fail",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    }),
  completed: (ctx: CheckoutHostContext, checkoutSessionId: string | null) =>
    post({
      event_name: "stripe_checkout_complete",
      sw_checkout_id: checkoutSessionId,
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    }),
});
