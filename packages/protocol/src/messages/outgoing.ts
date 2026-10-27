import { z } from "zod";
import { PermissionTypeSchema } from "./permissions";

const ping = z.object({
  event_name: z.literal("ping"),
  substitutions: z.array(z.unknown()),
  products: z.array(z.object({ product: z.enum(["primary", "secondary", "tertiary"]) })).optional(),
  coordinates: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
  version: z.string().optional(),
  fonts: z.array(z.object({ family: z.string() })).optional(),
  page_styles: z.array(z.unknown()),
  host_controlled: z.boolean().optional(),
});

const close = z.object({ event_name: z.literal("close") });

const openUrl = z.object({
  event_name: z.literal("open_url"),
  url: z.string(),
  browser_type: z.literal("payment_sheet").optional(),
});

const openUrlExternal = z.object({
  event_name: z.literal("open_url_external"),
  url: z.string(),
  teleport: z.boolean().optional(),
  waiting_screen: z.boolean().optional(),
});

const requestStoreReview = z.object({
  event_name: z.literal("request_store_review"),
  review_type: z.enum(["in-app", "external"]),
});

const openDeepLink = z.object({
  event_name: z.literal("open_deep_link"),
  link: z.string(),
});

const openPaymentSheet = z.object({
  event_name: z.literal("open_payment_sheet"),
  url: z.string(),
});

const restore = z.object({ event_name: z.literal("restore") });

const purchase = z.object({
  event_name: z.literal("purchase"),
  product: z.string(),
  product_identifier: z.string().optional(),
  should_dismiss: z.boolean().optional(),
});

const custom = z.object({
  event_name: z.literal("custom"),
  data: z.string(),
});

const userAttributeUpdated = z.object({
  event_name: z.literal("user_attribute_updated"),
  attributes: z.array(z.object({ key: z.string(), value: z.string() })),
});

const customPlacement = z.object({
  event_name: z.literal("custom_placement"),
  name: z.string(),
  params: z.object({}).passthrough(),
});

const varClick = z.object({
  event_name: z.literal("var_click"),
  var_name: z.string(),
});

const pageStyles = z.object({
  event_name: z.literal("page_styles"),
  page_styles: z.array(z.unknown()),
});

const hasSetDom = z.object({
  event_name: z.literal("has_set_dom"),
  data: z.object({}).passthrough(),
});

const initiateWebCheckout = z.object({
  event_name: z.literal("initiate_web_checkout"),
  checkout_context_id: z.string(),
  product_identifier: z.string(),
  paywall_identifier: z.string().optional(),
  experiment_variant_id: z.string().optional(),
  presented_by_event_name: z.string().optional(),
  store: z.literal("STRIPE"),
});

const scheduleNotification = z.object({
  event_name: z.literal("schedule_notification"),
  id: z.string(),
  type: z.literal("TRIAL_STARTED"),
  title: z.string(),
  subtitle: z.string().optional(),
  body: z.string(),
  delay: z.number(),
});

const hapticFeedback = z.object({
  event_name: z.literal("haptic_feedback"),
  haptic_type: z.enum(["light", "medium", "heavy", "success", "warning", "error", "selection"]),
});

const requestPermission = z.object({
  event_name: z.literal("request_permission"),
  permission_type: PermissionTypeSchema,
  request_id: z.string(),
});

const requestCallback = z.object({
  event_name: z.literal("request_callback"),
  request_id: z.string(),
  name: z.string(),
  behavior: z.enum(["non-blocking", "blocking"]),
  variables: z.record(z.string(), z.any()).optional(),
});

const stripeCheckout = <E extends string>(eventName: E) =>
  z.object({
    event_name: z.literal(eventName),
    checkout_context_id: z.string(),
    product_identifier: z.string(),
  });

const stripeCheckoutStart = stripeCheckout("stripe_checkout_start");
const stripeCheckoutPrefetch = stripeCheckout("stripe_checkout_prefetch");
const stripeCheckoutAbandon = stripeCheckout("stripe_checkout_abandon");
const stripeCheckoutFail = stripeCheckout("stripe_checkout_fail");
const stripeCheckoutSubmit = stripeCheckout("stripe_checkout_submit");

const postPurchaseBehavior = z.enum(["GRANT_ACCESS", "REDIRECT", "REDEEM", "CUSTOM"]);

const postCheckoutResolution = z.union([
  z.object({ type: z.literal("default") }),
  z.object({ type: z.literal("redeem") }),
  z.object({ type: z.literal("redirect"), url: z.string() }),
  z.object({ type: z.literal("paywall") }),
]);

const redemptionCode = z.object({ code: z.string(), claimed: z.boolean() });

const stripeCheckoutComplete = z.object({
  event_name: z.literal("stripe_checkout_complete"),
  claimed: z.boolean().optional(),
  redemption_codes: z.array(redemptionCode).optional(),
  sw_checkout_id: z.string().nullish(),
  checkout_context_id: z.string(),
  product_identifier: z.string(),
  post_purchase_resolution: postCheckoutResolution.optional(),
  post_purchase_behavior: postPurchaseBehavior.optional(),
  entitlements_token: z.string().optional(),
  should_dismiss: z.boolean().optional(),
});

const teleportWatchStart = z.object({
  event_name: z.literal("teleport_watch_start"),
  teleport_id: z.string(),
  teleport_status_url: z.string(),
  checkout_status_url: z.string(),
  public_api_key: z.string(),
});

const teleportWatchEnd = z.object({ event_name: z.literal("teleport_watch_end") });

const postCheckoutComplete = z.object({
  event_name: z.literal("post_checkout_complete"),
  checkout_context_id: z.string(),
  product_identifier: z.string(),
  transaction_data: z
    .object({
      transaction_id: z.string(),
      product_identifier: z.string(),
      currency: z.string().optional(),
      value: z.number().optional(),
    })
    .optional(),
  redirect_url: z.string().optional(),
  redemption_codes: z.array(z.string()).optional(),
  post_purchase_behavior: postPurchaseBehavior.optional(),
  entitlements_token: z.string().optional(),
});

const discountRedemptionResult = z.object({
  event_name: z.literal("discount_redemption_result"),
  code: z.string(),
  valid: z.boolean(),
  reason: z.string().optional(),
  appliedProductCount: z.number().optional(),
});

const pageView = z.object({
  event_name: z.literal("page_view"),
  type: z.enum(["entry", "forward", "back", "auto_transition"]),
  page_node_id: z.string(),
  flow_position: z.number(),
  page_name: z.string(),
  navigation_node_id: z.string(),
  previous_page_node_id: z.string().optional(),
  previous_flow_position: z.number().optional(),
  time_on_previous_page_ms: z.number().optional(),
});

export const OutgoingMessageSchema = z.union([
  ping,
  close,
  openUrl,
  openUrlExternal,
  openDeepLink,
  openPaymentSheet,
  restore,
  purchase,
  custom,
  varClick,
  userAttributeUpdated,
  pageStyles,
  hasSetDom,
  customPlacement,
  requestStoreReview,
  initiateWebCheckout,
  scheduleNotification,
  hapticFeedback,
  requestPermission,
  requestCallback,
  stripeCheckoutPrefetch,
  stripeCheckoutStart,
  stripeCheckoutAbandon,
  stripeCheckoutFail,
  stripeCheckoutComplete,
  stripeCheckoutSubmit,
  postCheckoutComplete,
  discountRedemptionResult,
  pageView,
  teleportWatchStart,
  teleportWatchEnd,
]);

export type TOutgoingMessage = z.infer<typeof OutgoingMessageSchema>;
