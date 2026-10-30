import type { TOutgoingMessage, TPermissionTypeMessage } from "@superwall/protocol";
import type { SuperwallProduct } from "../products";

export type Outgoing<E extends TOutgoingMessage["event_name"]> = Extract<
  TOutgoingMessage,
  { event_name: E }
>;

export const PING_VERSION = "4.0.0";

export const ping = (): Outgoing<"ping"> => ({
  event_name: "ping",
  substitutions: [],
  page_styles: [],
  version: PING_VERSION,
});

export const close = (): Outgoing<"close"> => ({ event_name: "close" });

export const restore = (): Outgoing<"restore"> => ({ event_name: "restore" });

export const openUrl = (url: string, browserType?: "payment_sheet"): Outgoing<"open_url"> => ({
  event_name: "open_url",
  url,
  ...(browserType === undefined ? {} : { browser_type: browserType }),
});

export const openExternalUrl = (url: string): Outgoing<"open_url_external"> => ({
  event_name: "open_url_external",
  url,
});

export const openDeepLink = (link: string): Outgoing<"open_deep_link"> => ({
  event_name: "open_deep_link",
  link,
});

export const custom = (name: string): Outgoing<"custom"> => ({ event_name: "custom", data: name });

export const customPlacement = (
  name: string,
  params: Record<string, unknown>,
): Outgoing<"custom_placement"> => ({ event_name: "custom_placement", name, params });

export const userAttributeUpdated = (
  attributes: Outgoing<"user_attribute_updated">["attributes"],
): Outgoing<"user_attribute_updated"> => ({ event_name: "user_attribute_updated", attributes });

export const requestStoreReview = (
  reviewType: Outgoing<"request_store_review">["review_type"],
): Outgoing<"request_store_review"> => ({
  event_name: "request_store_review",
  review_type: reviewType,
});

export const hapticFeedback = (
  hapticType: Outgoing<"haptic_feedback">["haptic_type"],
): Outgoing<"haptic_feedback"> => ({ event_name: "haptic_feedback", haptic_type: hapticType });

export type PageViewInput = {
  type: Outgoing<"page_view">["type"];
  name: string;
  navigationId: string;
  position: number;
  previousName?: string;
  previousPosition?: number;
  timeOnPreviousMs?: number;
};

export const pageView = (input: PageViewInput): Outgoing<"page_view"> => ({
  event_name: "page_view",
  type: input.type,
  page_name: input.name,
  page_node_id: input.name,
  navigation_node_id: input.navigationId,
  flow_position: input.position,
  ...(input.previousName === undefined ? {} : { previous_page_node_id: input.previousName }),
  ...(input.previousPosition === undefined
    ? {}
    : { previous_flow_position: input.previousPosition }),
  ...(input.timeOnPreviousMs === undefined
    ? {}
    : { time_on_previous_page_ms: input.timeOnPreviousMs }),
});

export type NotificationInput = {
  id: string;
  title: string;
  subtitle?: string;
  body: string;
  delayMs: number;
};

export const scheduleNotification = (
  input: NotificationInput,
): Outgoing<"schedule_notification"> => ({
  event_name: "schedule_notification",
  id: input.id,
  type: "TRIAL_STARTED",
  title: input.title,
  ...(input.subtitle === undefined ? {} : { subtitle: input.subtitle }),
  body: input.body,
  delay: input.delayMs,
});

export const requestPermission = (
  permissionType: TPermissionTypeMessage,
  requestId: string,
): Outgoing<"request_permission"> => ({
  event_name: "request_permission",
  permission_type: permissionType,
  request_id: requestId,
});

export type CallbackRequestInput = {
  requestId: string;
  name: string;
  behavior: "blocking" | "non-blocking";
  variables?: Record<string, unknown>;
};

export const requestCallback = (input: CallbackRequestInput): Outgoing<"request_callback"> => ({
  event_name: "request_callback",
  request_id: input.requestId,
  name: input.name,
  behavior: input.behavior,
  ...(input.variables === undefined ? {} : { variables: input.variables }),
});

export const purchase = (
  product: SuperwallProduct,
  shouldDismiss: boolean | undefined,
): Outgoing<"purchase"> => ({
  event_name: "purchase",
  product: product.reference,
  ...(product.productId === undefined ? {} : { product_identifier: product.productId }),
  ...(shouldDismiss === undefined ? {} : { should_dismiss: shouldDismiss }),
});
