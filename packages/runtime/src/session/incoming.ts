import type { TIncomingMessage } from "@superwall/protocol";
import { permissionStateName } from "./requests";
import type {
  SuperwallPaywallIdentity,
  SuperwallPresentation,
  SuperwallRuntimeSnapshot,
} from "./types";
import { recordFromVariables } from "./variables";

const PRESENTED_BY = ["placement", "event"] as const;
const PRESENTATION_SOURCE_TYPES = ["implicit", "getPaywall", "register"] as const;

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

const presentationOf = (
  message: Extract<TIncomingMessage, { event_name: "paywall_open" }>,
): SuperwallPresentation => {
  const id = nonEmpty(message.presentation_id);
  const presentedBy = PRESENTED_BY.find((value) => value === message.presented_by);
  const sourceType = PRESENTATION_SOURCE_TYPES.find(
    (value) => value === message.presentation_source_type,
  );
  const eventId = nonEmpty(message.presented_by_event_id);
  const eventName = nonEmpty(message.presented_by_event_name);
  return {
    ...(id === undefined ? {} : { id }),
    ...(presentedBy === undefined ? {} : { presentedBy }),
    ...(sourceType === undefined ? {} : { sourceType }),
    ...(eventId === undefined ? {} : { eventId }),
    ...(eventName === undefined ? {} : { eventName }),
  };
};

const withPresentation = (
  paywall: SuperwallPaywallIdentity,
  presentation: SuperwallPresentation,
): SuperwallPaywallIdentity =>
  Object.keys(presentation).length === 0 ? paywall : { ...paywall, presentation };

export const snapshotPatchFor = (
  snapshot: SuperwallRuntimeSnapshot,
  message: TIncomingMessage,
): Partial<SuperwallRuntimeSnapshot> | undefined => {
  switch (message.event_name) {
    case "paywall_open":
      return {
        paywall: withPresentation(
          { id: message.paywall_id, identifier: message.paywall_identifier },
          presentationOf(message),
        ),
        pendingPurchase: undefined,
        lastTransaction: undefined,
        lastPurchaseFailure: undefined,
      };
    case "template_variables":
      return {
        variables: message.variables,
        device: recordFromVariables(message.variables, "device"),
        user: recordFromVariables(message.variables, "user"),
        params: recordFromVariables(message.variables, "params"),
      };
    case "template_substitutions_prefix":
      return { introductoryOffer: { eligible: message.prefix === "freeTrial" } };
    case "experiment":
      return {
        experiment: {
          experimentId: message.experimentId,
          variantId: message.variantId,
          campaignId: message.campaignId,
        },
      };
    case "restore_start":
      return { restore: { status: "started" } };
    case "restore_complete":
      return { restore: { status: "completed" } };
    case "restore_fail":
      return { restore: { status: "failed" } };
    case "event_tracking_behavior":
      return { eventTrackingBehavior: message.behavior };
    case "permission_result":
      return {
        permissionStatuses: {
          ...snapshot.permissionStatuses,
          [permissionStateName(message.permission_type)]: message.status,
        },
      };
    default:
      return undefined;
  }
};
