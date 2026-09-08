import type { TOutgoingMessage, TPermissionStatus } from "@superwall/protocol";
import type { HostProduct } from "../state";
import type {
  Answer,
  CallbackResult,
  HostDelegate,
  PermissionType,
  PurchaseOutcome,
  RestoreOutcome,
  UrlKind,
} from "./types";

export type DelegateAnswers = {
  purchase?: PurchaseOutcome | ((product: HostProduct) => Answer<PurchaseOutcome>);
  restore?: RestoreOutcome | (() => Answer<RestoreOutcome>);
  permission?: TPermissionStatus | ((type: PermissionType) => Answer<TPermissionStatus>);
  callback?:
    | CallbackResult
    | ((name: string, variables: Record<string, unknown>) => Answer<CallbackResult>);
};

export type RecordedCall =
  | { kind: "close" }
  | { kind: "openUrl"; url: string; urlKind: UrlKind }
  | { kind: "custom"; data: string }
  | { kind: "customPlacement"; name: string; params: Record<string, unknown> };

export type RecordingDelegate = HostDelegate & {
  events: TOutgoingMessage[];
  calls: RecordedCall[];
};

export const recordingDelegate = (answers: DelegateAnswers = {}): RecordingDelegate => {
  const events: TOutgoingMessage[] = [];
  const calls: RecordedCall[] = [];
  return {
    events,
    calls,
    event: (message) => {
      events.push(message);
    },
    purchase: (product) =>
      typeof answers.purchase === "function"
        ? answers.purchase(product)
        : (answers.purchase ?? "completed"),
    restore: () =>
      typeof answers.restore === "function" ? answers.restore() : (answers.restore ?? "restored"),
    close: () => {
      calls.push({ kind: "close" });
    },
    openUrl: (url, urlKind) => {
      calls.push({ kind: "openUrl", url, urlKind });
    },
    custom: (data) => {
      calls.push({ kind: "custom", data });
    },
    customPlacement: (name, params) => {
      calls.push({ kind: "customPlacement", name, params });
    },
    permission: (type) =>
      typeof answers.permission === "function"
        ? answers.permission(type)
        : (answers.permission ?? "granted"),
    callback: (name, variables) =>
      typeof answers.callback === "function"
        ? answers.callback(name, variables)
        : (answers.callback ?? { status: "success" }),
  };
};
