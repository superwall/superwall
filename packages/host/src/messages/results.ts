import type {
  TIncomingMessageCallbackResult,
  TIncomingMessagePermissionResult,
} from "@superwall/protocol";

export const permissionResult = (input: {
  permissionType: TIncomingMessagePermissionResult["permission_type"];
  requestId: string;
  status: TIncomingMessagePermissionResult["status"];
}): TIncomingMessagePermissionResult => ({
  event_name: "permission_result",
  permission_type: input.permissionType,
  request_id: input.requestId,
  status: input.status,
});

export const callbackResult = (input: {
  requestId: string;
  name: string;
  status: TIncomingMessageCallbackResult["status"];
  data?: Record<string, unknown>;
}): TIncomingMessageCallbackResult => ({
  event_name: "callback_result",
  request_id: input.requestId,
  name: input.name,
  status: input.status,
  ...(input.data === undefined ? {} : { data: input.data }),
});
