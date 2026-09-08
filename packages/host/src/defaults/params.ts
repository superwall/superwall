import type { HostVariables } from "../state";

export const DEFAULT_PARAMS = {
  $event_name: "campaign_trigger",
  event_name: "campaign_trigger",
  $is_standard_event: false,
  $is_feature_gatable: false,
} satisfies HostVariables;
