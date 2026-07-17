import type {
  TIncomingMessage,
  TIncomingMessageCallbackResult,
  TIncomingMessageTransactionAbandon,
  TIncomingMessageTransactionComplete,
  TOutgoingMessage,
} from "@superwall/protocol";
import type { SuperwallBridge, SuperwallBridgeOptions, SuperwallMessageLogEntry } from "../bridge";
import type { SuperwallConfig } from "../config";
import type { SuperwallProduct } from "../products";
import type {
  SuperwallCallbackStates,
  SuperwallPermissionStatuses,
  SuperwallSdkState,
} from "./state";
import type {
  SuperwallDeviceVariables,
  SuperwallExperiment,
  SuperwallPlacementParams,
  SuperwallUserVariables,
} from "./variables";

export type SuperwallRuntimeStatus = "idle" | "listening";

export type SuperwallPaywallIdentity = {
  id: string;
  identifier: string;
};

export type SuperwallPendingPurchase<out TProduct extends SuperwallProduct = SuperwallProduct> = {
  reference: string;
  product: TProduct;
};

export type SuperwallTransaction<TProduct extends SuperwallProduct = SuperwallProduct> =
  | {
      status: "completed";
      product: TProduct;
      message: TIncomingMessageTransactionComplete;
    }
  | {
      status: "abandoned";
      product: TProduct;
      message: TIncomingMessageTransactionAbandon;
    };

export type SuperwallPurchaseFailure<out TProduct extends SuperwallProduct = SuperwallProduct> = {
  status: "failed";
  product: TProduct;
  /**
   * "timeout": no transaction message arrived in time. "superseded": a newer
   * purchase for the same product, or a paywall re-open, replaced this one.
   */
  reason: "timeout" | "superseded";
};

export type SuperwallPurchaseResult<TProduct extends SuperwallProduct = SuperwallProduct> =
  | SuperwallTransaction<TProduct>
  | SuperwallPurchaseFailure<TProduct>;

export type SuperwallCallbackResult<TData = Record<string, unknown>> = {
  status: TIncomingMessageCallbackResult["status"];
  data?: TData;
  message: TIncomingMessageCallbackResult;
};

export type SuperwallTrialState = {
  /**
   * Whether the user is eligible for an introductory offer. `undefined` until
   * the SDK signals eligibility (or the config forces it).
   */
  eligible?: boolean;
};

export type SuperwallRuntimeSnapshot<out TProduct extends SuperwallProduct = SuperwallProduct> = {
  status: SuperwallRuntimeStatus;
  config?: SuperwallConfig;
  paywall?: SuperwallPaywallIdentity;
  products: readonly TProduct[];
  productsByReference: Readonly<Record<string, TProduct>>;
  variables: Readonly<Record<string, unknown>>;
  device: SuperwallDeviceVariables;
  user: SuperwallUserVariables;
  params: SuperwallPlacementParams;
  experiment?: SuperwallExperiment;
  trial: SuperwallTrialState;
  locale: string;
  state: SuperwallSdkState;
  permissionStatuses: SuperwallPermissionStatuses;
  callbackStates: SuperwallCallbackStates;
  messages: readonly SuperwallMessageLogEntry[];
  pendingPurchase?: SuperwallPendingPurchase<TProduct>;
  lastTransaction?: SuperwallTransaction<TProduct>;
  lastPurchaseFailure?: SuperwallPurchaseFailure<TProduct>;
};

export type SuperwallPurchaseOptions = {
  shouldDismiss?: boolean;
  /** Resolve as `{ status: "failed", reason: "timeout" }` if no transaction message arrives in time. */
  timeoutMs?: number;
};

export type SuperwallEventMap = {
  [E in TIncomingMessage["event_name"]]: Extract<TIncomingMessage, { event_name: E }>;
} & {
  /** Fires for every incoming message. */
  message: TIncomingMessage;
};

export type SuperwallEventName = keyof SuperwallEventMap & string;

export type SuperwallSessionStartOptions = {
  sendPing?: boolean;
  ping?: Partial<Extract<TOutgoingMessage, { event_name: "ping" }>>;
};

export type SuperwallSessionOptions<TProduct extends SuperwallProduct = SuperwallProduct> =
  SuperwallBridgeOptions & {
    bridge?: SuperwallBridge;
    config?: SuperwallConfig;
    products?: readonly TProduct[];
    variables?: Record<string, unknown>;
  };
