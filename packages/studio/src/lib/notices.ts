import type { TIncomingMessage, TOutgoingMessage } from "@superwall/host";

export type PaywallEventName = TOutgoingMessage["event_name"];

export type PaywallMessageName = PaywallEventName | TIncomingMessage["event_name"];

export type EventNotice = {
  action: PaywallEventName;
  subject?: string;
  tone: "info" | "success" | "warning";
};

const SILENT: ReadonlySet<PaywallEventName> = new Set<PaywallEventName>([
  "ping",
  "page_view",
  "page_styles",
  "has_set_dom",
  "haptic_feedback",
  "var_click",
  "purchase",
  "restore",
]);

const SUBJECT: Partial<Record<PaywallEventName, readonly string[]>> = {
  open_url: ["url"],
  open_url_external: ["url"],
  open_deep_link: ["link"],
  custom_placement: ["name"],
  custom: ["name", "data"],
  request_permission: ["permission_type"],
  request_callback: ["name"],
  schedule_notification: ["title"],
  discount_redemption_result: ["code"],
};

const WARNING: ReadonlySet<PaywallEventName> = new Set<PaywallEventName>(["close"]);

const SUCCESS: ReadonlySet<PaywallEventName> = new Set<PaywallEventName>([
  "stripe_checkout_complete",
  "post_checkout_complete",
]);

const subjectOf = (event: TOutgoingMessage): string | undefined => {
  for (const key of SUBJECT[event.event_name] ?? []) {
    const value = Reflect.get(event, key);
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
};

export const noticeFor = (event: TOutgoingMessage): EventNotice | undefined => {
  if (SILENT.has(event.event_name)) return undefined;

  return {
    action: event.event_name,
    subject: subjectOf(event),
    tone: WARNING.has(event.event_name)
      ? "warning"
      : SUCCESS.has(event.event_name)
        ? "success"
        : "info",
  };
};
