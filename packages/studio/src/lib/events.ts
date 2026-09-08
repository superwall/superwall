export type PaywallEvent = { event_name: string } & Record<string, unknown>;

export type EventNotice = {
  action: string;
  subject?: string;
  tone: "info" | "success" | "warning";
};

const SILENT = new Set([
  "ping",
  "page_view",
  "page_styles",
  "has_set_dom",
  "haptic_feedback",
  "var_click",
  "template_variables",
  "template_substitutions_prefix",
  "products",
  "paywall_open",
  "experiment",
  "purchase",
  "restore",
]);

const SUBJECT: Record<string, readonly string[]> = {
  open_url: ["url"],
  open_url_external: ["url"],
  open_deep_link: ["link", "url"],
  custom_placement: ["name", "placementName"],
  custom: ["name", "data"],
  request_permission: ["permission_type", "permissionType"],
  request_callback: ["name"],
  schedule_notification: ["title"],
};

const WARNING = new Set(["close", "transaction_abandon", "transaction_fail"]);

const SUCCESS = new Set(["transaction_complete", "freeTrial_start"]);

const subjectOf = (event: PaywallEvent): string | undefined => {
  for (const key of SUBJECT[event.event_name] ?? []) {
    const value = event[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
};

export const noticeFor = (event: PaywallEvent): EventNotice | undefined => {
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
