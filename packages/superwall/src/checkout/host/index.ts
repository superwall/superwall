import type { SuperwallSession } from "@superwall/runtime";
import type {
  DiscountValidationResult,
  PostCheckoutResolution,
  PostPurchaseBehavior,
} from "../types";

type HostMessage = Parameters<SuperwallSession["postMessage"]>[0];

export type HostContext = {
  checkoutContextId: string;
  productIdentifier: string;
  paywallIdentifier?: string;
  experimentVariantId?: string;
  presentedByEventName?: string;
};

export type HostEvents = ReturnType<typeof hostEvents>;

export const hostEvents = (post: (message: HostMessage) => void) => ({
  prefetched: (ctx: HostContext) =>
    post({
      event_name: "stripe_checkout_prefetch",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    }),
  initiated: (ctx: HostContext) => {
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
  submitted: (ctx: HostContext) =>
    post({
      event_name: "stripe_checkout_submit",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    }),
  abandoned: (ctx: HostContext) =>
    post({
      event_name: "stripe_checkout_abandon",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    }),
  failed: (ctx: HostContext) =>
    post({
      event_name: "stripe_checkout_fail",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
    }),
  completed: (
    ctx: HostContext,
    checkoutSessionId: string | null,
    postPurchaseBehavior?: PostPurchaseBehavior,
    resolution?: PostCheckoutResolution,
    entitlementsToken?: string,
  ) =>
    post({
      event_name: "stripe_checkout_complete",
      sw_checkout_id: checkoutSessionId,
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
      ...(resolution ? { post_purchase_resolution: resolution } : {}),
      ...(postPurchaseBehavior ? { post_purchase_behavior: postPurchaseBehavior } : {}),
      ...(entitlementsToken ? { entitlements_token: entitlementsToken } : {}),
    }),
  postCheckoutCompleted: (
    ctx: HostContext,
    postPurchaseBehavior?: PostPurchaseBehavior,
    entitlementsToken?: string,
  ) =>
    post({
      event_name: "post_checkout_complete",
      checkout_context_id: ctx.checkoutContextId,
      product_identifier: ctx.productIdentifier,
      ...(postPurchaseBehavior ? { post_purchase_behavior: postPurchaseBehavior } : {}),
      ...(entitlementsToken ? { entitlements_token: entitlementsToken } : {}),
    }),
  openHostedPage: (url: string) => post({ event_name: "open_url_external", url }),
  redeem: (link: string) => post({ event_name: "open_deep_link", link }),
  redemption: (code: string, result: DiscountValidationResult) =>
    post(
      result.valid
        ? {
            event_name: "discount_redemption_result",
            code,
            valid: true,
            appliedProductCount: result.products.filter((product) => product.applies).length,
          }
        : { event_name: "discount_redemption_result", code, valid: false, reason: result.reason },
    ),
});
