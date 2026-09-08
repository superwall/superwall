import type { TIncomingMessage } from "@superwall/protocol";
import { permissionStateName } from "./requests";
import type { SuperwallRuntimeSnapshot } from "./types";
import { recordFromVariables } from "./variables";

export const snapshotPatchFor = (
  snapshot: SuperwallRuntimeSnapshot,
  message: TIncomingMessage,
): Partial<SuperwallRuntimeSnapshot> | undefined => {
  switch (message.event_name) {
    case "paywall_open":
      return {
        paywall: { id: message.paywall_id, identifier: message.paywall_identifier },
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
