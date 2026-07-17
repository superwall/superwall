import { PageStyles } from "../pageStyles";
import { SubsSchema } from "../sub";
import { z } from "zod";

export const EnabledProductSchema = z.object({
  product: z.enum(["primary", "secondary", "tertiary"]),
});

/**
 * Tells the parent we're ready to start receiving messages.
 */
export const OutgoingMessagePingSchema = z.object({
  event_name: z.literal("ping"),
  substitutions: SubsSchema,
  products: z.array(EnabledProductSchema).optional(),
  coordinates: z
    .record(
      z.string(),
      z.object({
        x: z.number(),
        y: z.number(),
      }),
    )
    .optional(),
  version: z.string().optional(),
  fonts: z
    .array(
      z.object({
        family: z.string(),
      }),
    )
    .optional(),
  page_styles: PageStyles,
});

/**
 * Tells the parent to close the paywall
 */
const OutgoingMessageClose = z.object({
  event_name: z.literal("close"),
});

/**
 * Tells the parent to open a url
 */
const OutgoingMessageOpenURL = z.object({
  event_name: z.literal("open_url"),
  url: z.string(),
  browser_type: z.literal("payment_sheet").optional(),
});

/**
 * Tells the parent to open a url externally
 */
const OutgoingMessageOpenExternalURL = z.object({
  event_name: z.literal("open_url_external"),
  url: z.string(),
});

/**
 * Tells the parent to request a store review
 */
const OutgoingMessageRequestStoreReview = z.object({
  event_name: z.literal("request_store_review"),
  review_type: z.enum(["in-app", "external"]),
});

/**
 * Tells the parent to open a deep link
 */
const OutgoingMessageOpenDeepLink = z.object({
  event_name: z.literal("open_deep_link"),
  link: z.string(),
});

/**
 * Tells the parent to open a payment sheet
 */
const OutgoingMessageOpenPaymentSheet = z.object({
  event_name: z.literal("open_payment_sheet"),
  url: z.string(),
});

/**
 * Tells the parent to restore a purchase
 */
const OutgoingMessageRestore = z.object({
  event_name: z.literal("restore"),
});

/**
 * Tells the parent to purchase a product
 */
const OutgoingMessagePurchase = z.object({
  event_name: z.literal("purchase"),
  product: z.string(),
  product_identifier: z.string().optional(),
  should_dismiss: z.boolean().optional(),
});

/**
 * Tells the parent to send a custom message
 */
const OutgoingMessageCustom = z.object({
  event_name: z.literal("custom"),
  data: z.string(),
});

/**
 * Tells the parent that user attributes have been updated
 */
const OutgoingMessageUserAttributeUpdated = z.object({
  event_name: z.literal("user_attribute_updated"),
  attributes: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});

/**
 * Tells the parent to send a custom message
 */
const OutgoingMessageCustomPlacement = z.object({
  event_name: z.literal("custom_placement"),
  name: z.string(),
  params: z.object({}).passthrough(),
});

/**
 * Tells the parent we clicked a variable
 */
// This should really be sub_click, why did I do this!?
const OutgoingMessageVarClick = z.object({
  event_name: z.literal("var_click"),
  var_name: z.string(),
});

const OutgoingMessagePageStyles = z.object({
  event_name: z.literal("page_styles"),
  page_styles: PageStyles,
});

const OutgoingMessageHasSetDom = z.object({
  event_name: z.literal("has_set_dom"),
  data: z.object({}).passthrough(),
});

const OutgoingInitiateWebCheckout = z.object({
  event_name: z.literal("initiate_web_checkout"),
  checkout_context_id: z.string(),
  // Parameters needed for transaction_start event
  product_identifier: z.string(),
  paywall_identifier: z.string().optional(),
  experiment_variant_id: z.string().optional(),
  presented_by_event_name: z.string().optional(),
  store: z.literal("STRIPE"),
});

/**
 * Tells the SDK to schedule a local notification
 * with dynamic content
 */
const OutgoingMessageScheduleNotification = z.object({
  event_name: z.literal("schedule_notification"),
  id: z.string(), // Unique ID composed of paywallId + type
  type: z.literal("TRIAL_STARTED"),
  title: z.string(),
  subtitle: z.string().optional(),
  body: z.string(),
  // Delay in milliseconds
  delay: z.number(),
});

/**
 * Tells the SDK to trigger haptic feedback
 */
const OutgoingMessageHapticFeedback = z.object({
  event_name: z.literal("haptic_feedback"),
  haptic_type: z.enum(["light", "medium", "heavy", "success", "warning", "error", "selection"]),
});
/**
 * Permission types that can be requested from the host app
 *
 * Platform availability:
 * - notification: iOS, Android
 * - background_location: iOS, Android
 * - location: iOS, Android
 * - read_images: iOS, Android
 * - contacts: iOS, Android
 * - read_video: Android only
 * - camera: iOS, Android
 * - microphone: iOS, Android
 */
export const PermissionTypeSchema = z.enum([
  "notification",
  "background_location",
  "location",
  "read_images",
  "contacts",
  "read_video",
  "camera",
  "tracking",
  "microphone",
]);

export type TPermissionTypeMessage = z.infer<typeof PermissionTypeSchema>;

/**
 * Tells the parent to request a permission from the user
 */
const OutgoingMessageRequestPermission = z.object({
  event_name: z.literal("request_permission"),
  permission_type: PermissionTypeSchema,
  request_id: z.string(), // For correlating with permission_result response
});

/**
 * Requests a custom callback from the SDK
 * Used for custom actions where the paywall needs a response
 */
const OutgoingMessageRequestCallback = z.object({
  event_name: z.literal("request_callback"),
  request_id: z.string(), // UUID for correlation with callback_result
  name: z.string(), // The callback name identifier
  behavior: z.enum(["non-blocking", "blocking"]), // How the callback executes
  variables: z.record(z.string(), z.any()).optional(), // Dict of variableName: variableValue
});

const OutgoingStripeCheckoutStart = z.object({
  event_name: z.literal("stripe_checkout_start"),
  checkout_context_id: z.string(),
  product_identifier: z.string(),
});

const OutgoingStripeCheckoutPrefetch = z.object({
  event_name: z.literal("stripe_checkout_prefetch"),
  checkout_context_id: z.string(),
  product_identifier: z.string(),
});

const OutgoingStripeCheckoutAbandon = z.object({
  event_name: z.literal("stripe_checkout_abandon"),
  checkout_context_id: z.string(),
  product_identifier: z.string(),
});

const OutgoingStripeCheckoutFail = z.object({
  event_name: z.literal("stripe_checkout_fail"),
  checkout_context_id: z.string(),
  product_identifier: z.string(),
});

const PostCheckoutResolution = z.union([
  z.object({ type: z.literal("default") }),
  z.object({ type: z.literal("redeem") }),
  z.object({ type: z.literal("redirect"), url: z.string() }),
  z.object({ type: z.literal("paywall") }),
]);

const OutgoingStripeCheckoutComplete = z.object({
  event_name: z.literal("stripe_checkout_complete"),
  sw_checkout_id: z.string().nullish(),
  checkout_context_id: z.string(),
  product_identifier: z.string(),
  post_purchase_resolution: PostCheckoutResolution.optional(),
});

const OutgoingStripeCheckoutSubmit = z.object({
  event_name: z.literal("stripe_checkout_submit"),
  checkout_context_id: z.string(),
  product_identifier: z.string(),
});

const OutgoingMessagePageView = z.object({
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
  OutgoingMessagePingSchema,
  OutgoingMessageClose,
  OutgoingMessageOpenURL,
  OutgoingMessageOpenExternalURL,
  OutgoingMessageOpenDeepLink,
  OutgoingMessageOpenPaymentSheet,
  OutgoingMessageRestore,
  OutgoingMessagePurchase,
  OutgoingMessageCustom,
  OutgoingMessageVarClick,
  OutgoingMessageUserAttributeUpdated,
  OutgoingMessagePageStyles,
  OutgoingMessageHasSetDom,
  OutgoingMessageCustomPlacement,
  OutgoingMessageRequestStoreReview,
  OutgoingInitiateWebCheckout,
  OutgoingMessageScheduleNotification,
  OutgoingMessageHapticFeedback,
  OutgoingMessageRequestPermission,
  OutgoingMessageRequestCallback,
  OutgoingStripeCheckoutPrefetch,
  OutgoingStripeCheckoutStart,
  OutgoingStripeCheckoutAbandon,
  OutgoingStripeCheckoutFail,
  OutgoingStripeCheckoutComplete,
  OutgoingStripeCheckoutSubmit,
  OutgoingMessagePageView,
]);

export type TOutgoingMessage = z.infer<typeof OutgoingMessageSchema>;
