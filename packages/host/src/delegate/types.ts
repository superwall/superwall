import type { TOutgoingMessage, TPermissionStatus } from "@superwall/protocol";

export type { TIncomingMessage, TOutgoingMessage } from "@superwall/protocol";
import type { HostProduct } from "../state";

export type PurchaseOutcome = "completed" | "abandoned" | "failed";
export type RestoreOutcome = "restored" | "failed";
export type UrlKind = "in_app" | "external" | "deep_link" | "payment_sheet";
export type PermissionType = Extract<
  TOutgoingMessage,
  { event_name: "request_permission" }
>["permission_type"];
export type CallbackResult = { status: "success" | "failure"; data?: Record<string, unknown> };

export type Answer<T> = T | Promise<T>;

export interface HostDelegate {
  event(message: TOutgoingMessage): void;
  purchase(product: HostProduct): Answer<PurchaseOutcome>;
  restore(): Answer<RestoreOutcome>;
  close(): void;
  openUrl(url: string, kind: UrlKind): void;
  custom(data: string): void;
  customPlacement(name: string, params: Record<string, unknown>): void;
  permission(type: PermissionType): Answer<TPermissionStatus>;
  callback(name: string, variables: Record<string, unknown>): Answer<CallbackResult>;
}
