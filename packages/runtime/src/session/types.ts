import type {
  ITransport,
  TEventTrackingBehavior,
  TIncomingMessage,
  TIncomingMessageCallbackResult,
  TIncomingMessageTransactionAbandon,
  TIncomingMessageTransactionComplete,
  TOutgoingMessage,
  TPermissionStatus,
  TPermissionTypeMessage,
  TransportKind,
} from "@superwall/protocol";
import type { SuperwallConfig, SuperwallPostPurchase } from "../config";
import type { SuperwallTranslateValues } from "../localization";
import type {
  SuperwallProduct,
  SuperwallProductInput,
  SuperwallProductVariables,
} from "../products";
import type { Outgoing, PageViewInput } from "./outgoing";
import type { CallbackBehavior } from "./requests";
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
  reason: "sdk" | "superseded";
};

export type SuperwallRestoreState = {
  status: "started" | "completed" | "failed";
};

/**
 * How a restore ended.
 *
 * Deliberately no product list and no reason. The SDK announces a restored
 * transaction with `transaction_restore`, which carries no payload, and reports
 * "nothing to restore" as `restore_fail` like any other failure — the message it
 * logs for that case never reaches the paywall.
 */
export type SuperwallRestoreResult = { status: "restored" | "failed" };

export type SuperwallPurchaseResult<TProduct extends SuperwallProduct = SuperwallProduct> =
  | SuperwallTransaction<TProduct>
  | SuperwallPurchaseFailure<TProduct>;

export type SuperwallCallbackResult<TData = Record<string, unknown>> = {
  status: TIncomingMessageCallbackResult["status"];
  data?: TData;
  message: TIncomingMessageCallbackResult;
};

export type SuperwallIntroductoryOfferState = {
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
  introductoryOffer: SuperwallIntroductoryOfferState;
  restore?: SuperwallRestoreState;
  eventTrackingBehavior?: TEventTrackingBehavior;
  locale: string;
  state: SuperwallSdkState;
  permissionStatuses: SuperwallPermissionStatuses;
  callbackStates: SuperwallCallbackStates;
  pendingPurchase?: SuperwallPendingPurchase<TProduct>;
  lastTransaction?: SuperwallTransaction<TProduct>;
  lastPurchaseFailure?: SuperwallPurchaseFailure<TProduct>;
};

export type SuperwallPurchaseOptions = {
  /**
   * What happens once this purchase completes, overriding the config's
   * `postPurchase` for this call. See `SuperwallPostPurchase`.
   */
  postPurchase?: SuperwallPostPurchase;
  /**
   * Key/value pairs written onto the Stripe subscription (or payment) once
   * a web purchase completes — a quiz session id, a plan name, anything you
   * want to see in Stripe and in webhooks. Values are strings. Ignored by
   * store purchases, which have no Stripe object to write to.
   */
  stripeMetadata?: Readonly<Record<string, string>>;
};

export type SuperwallCallbackOptions = {
  behavior?: CallbackBehavior;
  variables?: Record<string, unknown>;
};

export type SuperwallEventName = TIncomingMessage["event_name"] | "message";

export type SuperwallEventMap = {
  [E in SuperwallEventName]: E extends "message"
    ? TIncomingMessage
    : Extract<TIncomingMessage, { event_name: E }>;
};

export type SuperwallSessionStartOptions = {
  sendPing?: boolean;
};

export type SuperwallSessionOptions = {
  config?: SuperwallConfig;
  transport?: ITransport;
  transportKind?: TransportKind;
  onDecodeError?: (error: unknown) => void;
};

export type SuperwallUserAttributes = Readonly<Record<string, string | number | boolean>>;

export type SuperwallSuppliedProduct = {
  reference: string;
  productId: string;
  variables: SuperwallProductVariables;
};

export interface SuperwallSession<out TProduct extends SuperwallProduct = SuperwallProduct> {
  on: <E extends SuperwallEventName>(
    event: E,
    handler: (payload: SuperwallEventMap[E]) => void,
  ) => () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SuperwallRuntimeSnapshot<TProduct>;
  t: (key: string, values?: SuperwallTranslateValues) => string;
  setLocale: (locale: string | undefined) => void;
  configure: (config: SuperwallConfig) => void;
  start: (options?: SuperwallSessionStartOptions) => void;
  postMessage: (message: TOutgoingMessage) => void;
  accept: (messages: TIncomingMessage[]) => void;
  accept64: (message: string) => void;
  supplyProducts: (products: readonly SuperwallSuppliedProduct[]) => void;
  close: () => void;
  restore: () => Promise<SuperwallRestoreResult>;
  openUrl: (url: string, options?: { browserType?: "payment_sheet" }) => void;
  openExternalUrl: (url: string) => void;
  openDeepLink: (link: string) => void;
  customPlacement: (name: string, params?: Record<string, unknown>) => void;
  setUserAttributes: (attributes: SuperwallUserAttributes) => void;
  requestStoreReview: (reviewType: Outgoing<"request_store_review">["review_type"]) => void;
  pageView: (input: PageViewInput) => void;
  hapticFeedback: (hapticType: Outgoing<"haptic_feedback">["haptic_type"]) => void;
  requestPermission: (permissionType: TPermissionTypeMessage) => Promise<TPermissionStatus>;
  requestCallback: <TData extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    options?: SuperwallCallbackOptions,
  ) => Promise<SuperwallCallbackResult<TData>>;
  purchase: (
    input: SuperwallProductInput,
    options?: SuperwallPurchaseOptions,
  ) => Promise<SuperwallPurchaseResult<TProduct>>;
}
