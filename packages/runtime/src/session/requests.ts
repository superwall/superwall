import type {
  TIncomingMessageCallbackResult,
  TIncomingMessagePermissionResult,
  TPermissionStatus,
  TPermissionTypeMessage,
} from "@superwall/protocol";
import type { SuperwallCallbackResult } from "./types";

export const createRequestId = (prefix: string): string => {
  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${unique}`;
};

export const permissionStateName = (permissionType: TPermissionTypeMessage): string =>
  permissionType.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

export const callbackStateName = (name: string): string => {
  const segments = name
    .replace(/[^a-zA-Z0-9]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (segments.length === 0) return "callback";
  return segments
    .map((segment, index) =>
      index === 0
        ? segment.charAt(0).toLowerCase() + segment.slice(1)
        : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join("");
};

export type CallbackBehavior = "blocking" | "non-blocking";

export type RequestTracker = {
  permission: (permissionType: TPermissionTypeMessage) => {
    requestId: string;
    result: Promise<TPermissionStatus>;
  };
  callback: (
    name: string,
    behavior: CallbackBehavior,
  ) => { requestId: string; result: Promise<SuperwallCallbackResult> };
  resolvePermission: (message: TIncomingMessagePermissionResult) => void;
  resolveCallback: (message: TIncomingMessageCallbackResult) => string | undefined;
};

export const createRequestTracker = (): RequestTracker => {
  const permissions = new Map<string, (status: TPermissionStatus) => void>();
  const callbacks = new Map<
    string,
    { name: string; resolve: (result: SuperwallCallbackResult) => void }
  >();

  return {
    permission: (permissionType) => {
      const requestId = createRequestId(`permission-${permissionType}`);
      const result = new Promise<TPermissionStatus>((resolve) => {
        permissions.set(requestId, resolve);
      });
      return { requestId, result };
    },
    callback: (name, behavior) => {
      const requestId = createRequestId(`${callbackStateName(name)}-${behavior}`);
      const result = new Promise<SuperwallCallbackResult>((resolve) => {
        callbacks.set(requestId, { name, resolve });
      });
      return { requestId, result };
    },
    resolvePermission: (message) => {
      const resolve = permissions.get(message.request_id);
      if (!resolve) return;
      permissions.delete(message.request_id);
      resolve(message.status);
    },
    resolveCallback: (message) => {
      const entry = callbacks.get(message.request_id);
      if (!entry) return undefined;
      callbacks.delete(message.request_id);
      entry.resolve({ status: message.status, data: message.data, message });
      return entry.name;
    },
  };
};
