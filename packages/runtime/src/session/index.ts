import type {
  TIncomingMessage,
  TIncomingMessageTransactionAbandon,
  TIncomingMessageTransactionComplete,
  TOutgoingMessage,
} from "@superwall/protocol";
import { decodeIncomingMessages } from "../bridge/base64";
import { createRuntimeTransport } from "../bridge/transport";
import { normalizePlatform, productIdFor } from "../config";
import { createTranslator, languageCandidates, resolveLocale } from "../localization";
import {
  createProductDeriver,
  createSuperwallProduct,
  findProductByStoreId,
  mergeIncomingProducts,
  mergeProductVariables,
  productReferenceFromInput,
  productVariablesFromTemplateVariables,
  productsByReference,
  type SuperwallProduct,
  type SuperwallProductInput,
} from "../products";
import { snapshotPatchFor } from "./incoming";
import * as outgoing from "./outgoing";
import { createPurchaseTracker } from "./purchases";
import { createRestoreTracker } from "./restores";
import { callbackStateName, createRequestTracker } from "./requests";
import { trialReminderFor } from "./reminders";
import { buildSuperwallState } from "./state";
import type {
  SuperwallCallbackOptions,
  SuperwallCallbackResult,
  SuperwallEventMap,
  SuperwallEventName,
  SuperwallPurchaseFailure,
  SuperwallRuntimeSnapshot,
  SuperwallSession,
  SuperwallSessionOptions,
  SuperwallTransaction,
} from "./types";

type HandlerSets = {
  [E in SuperwallEventName]?: Set<(payload: SuperwallEventMap[E]) => void>;
};

type TransactionMessage = TIncomingMessageTransactionComplete | TIncomingMessageTransactionAbandon;

const createSession = (options: SuperwallSessionOptions): SuperwallSession => {
  const transport = options.transport ?? createRuntimeTransport(options.transportKind);
  const listeners = new Set<() => void>();
  const handlers: HandlerSets = {};
  const purchases = createPurchaseTracker();
  const restores = createRestoreTracker();
  const requests = createRequestTracker();
  const derive = createProductDeriver();

  let raw: readonly SuperwallProduct[] = [];
  let localeOverride: string | undefined;
  let translator = createTranslator(
    options.config?.localization,
    resolveLocale(undefined, options.config?.localization),
  );

  let snapshot: SuperwallRuntimeSnapshot = {
    status: "idle",
    config: options.config,
    products: [],
    productsByReference: {},
    variables: {},
    device: {},
    user: {},
    params: {},
    introductoryOffer: {},
    locale: translator.locale,
    permissionStatuses: {},
    callbackStates: {},
    state: buildSuperwallState({ variables: {}, products: [] }),
  };

  const commit = (patch: Partial<SuperwallRuntimeSnapshot>) => {
    const next = { ...snapshot, ...patch };
    const deviceLocale = next.device.deviceLocale ?? next.device.deviceLanguageCode;
    const requested =
      localeOverride ?? (typeof deviceLocale === "string" ? deviceLocale : undefined);
    const locale = resolveLocale(requested, next.config?.localization);
    if (locale !== translator.locale || next.config !== snapshot.config) {
      translator = createTranslator(next.config?.localization, locale);
    }

    const products = derive(raw, languageCandidates(requested));
    if (products !== next.products) {
      next.products = products;
      next.productsByReference = productsByReference(products);
    }

    snapshot = {
      ...next,
      locale,
      state: buildSuperwallState({
        variables: next.variables,
        products: next.products,
        paywall: next.paywall,
        lastTransaction: next.lastTransaction,
        permissionStatuses: next.permissionStatuses,
        callbackStates: next.callbackStates,
        introductoryOffer: next.introductoryOffer,
      }),
    };

    for (const listener of listeners) listener();
  };

  const post = (message: TOutgoingMessage) => {
    transport.postMessage(message);
  };

  const t: SuperwallSession["t"] = (key, values) => translator.t(key, values);

  const emit = <E extends SuperwallEventName>(event: E, payload: SuperwallEventMap[E]) => {
    handlers[event]?.forEach((handler) => handler(payload));
  };

  const devicePlatform = () =>
    normalizePlatform(
      typeof snapshot.device.platform === "string" ? snapshot.device.platform : undefined,
    );

  const resolveProduct = (input: SuperwallProductInput): SuperwallProduct => {
    const reference = productReferenceFromInput(input);
    const existing = snapshot.productsByReference[reference];
    if (existing) return existing;

    const slot = snapshot.config?.products?.[reference];
    if (slot === undefined || typeof input !== "string") return createSuperwallProduct(input);
    return createSuperwallProduct({
      reference,
      productId: productIdFor(slot, devicePlatform()),
      source: "inline",
    });
  };

  const productOfTransaction = (message: TransactionMessage): SuperwallProduct => {
    if (message.product !== undefined) return resolveProduct(message.product);
    return (
      findProductByStoreId(snapshot.products, message.product_identifier) ??
      createSuperwallProduct(message.product_identifier ?? "unknown")
    );
  };

  const withoutPending = (reference: string) =>
    snapshot.pendingPurchase?.reference === reference ? undefined : snapshot.pendingPurchase;

  const recordFailure = (failure: SuperwallPurchaseFailure) => {
    commit({
      pendingPurchase: withoutPending(failure.product.reference),
      lastPurchaseFailure: failure,
    });
  };

  const settleTransaction = (message: TransactionMessage) => {
    const pending = purchases.take(message);
    const product = pending?.product ?? productOfTransaction(message);
    const result: SuperwallTransaction =
      message.event_name === "transaction_complete"
        ? { status: "completed", product, message }
        : { status: "abandoned", product, message };
    pending?.resolve(result);
    commit({
      pendingPurchase: pending
        ? withoutPending(pending.product.reference)
        : snapshot.pendingPurchase,
      lastTransaction: result,
      lastPurchaseFailure: undefined,
    });
  };

  const handleIncoming = (message: TIncomingMessage) => {
    switch (message.event_name) {
      case "paywall_open":
        purchases.failAll("superseded");
        break;
      case "products":
        raw = mergeIncomingProducts(raw, message.products);
        break;
      case "template_variables": {
        const variables = productVariablesFromTemplateVariables(message.variables);
        if (variables.size > 0) raw = mergeProductVariables(raw, variables);
        break;
      }
      case "freeTrial_start": {
        const reminder = trialReminderFor(snapshot.config, message, {
          products: raw,
          t,
          locale: snapshot.locale,
          paywallIdentifier: snapshot.paywall?.identifier,
        });
        if (reminder) post(reminder);
        break;
      }
      case "transaction_complete":
      case "transaction_abandon":
        settleTransaction(message);
        break;
      case "transaction_fail":
      case "transaction_timeout": {
        const pending = purchases.find(message);
        const failure = pending && purchases.fail(pending.product.reference, "sdk");
        if (failure) recordFailure(failure);
        break;
      }
      case "restore_complete":
        restores.settle("restored");
        break;
      case "restore_fail":
        restores.settle("failed");
        break;
      case "permission_result":
        requests.resolvePermission(message);
        break;
      case "callback_result": {
        const name = callbackStateName(requests.resolveCallback(message) ?? message.name);
        commit({
          callbackStates: {
            ...snapshot.callbackStates,
            [name]: { result: message.status, data: message.data },
          },
        });
        break;
      }
      default:
        break;
    }

    commit(snapshotPatchFor(snapshot, message) ?? {});
    emit(message.event_name, message);
    emit("message", message);
  };

  transport.addListener(handleIncoming);

  const requestCallback = <TData extends Record<string, unknown>>(
    name: string,
    callbackOptions: SuperwallCallbackOptions = {},
  ): Promise<SuperwallCallbackResult<TData>> => {
    const behavior = callbackOptions.behavior ?? "blocking";
    const { requestId, result } = requests.callback(name, behavior);
    post(
      outgoing.requestCallback({ requestId, name, behavior, variables: callbackOptions.variables }),
    );
    // TData is the caller's claim about the SDK-owned payload — the same
    // unverifiable-claim seam as `createSuperwallSession`.
    return result as Promise<SuperwallCallbackResult<TData>>;
  };

  return {
    on: (event, handler) => {
      const set = handlers[event] ?? new Set<typeof handler>();
      if (!handlers[event]) Object.assign(handlers, { [event]: set });
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    t,
    setLocale: (locale) => {
      localeOverride = locale;
      commit({});
    },
    configure: (config) => {
      if (config !== snapshot.config) commit({ config });
    },
    start: (startOptions = {}) => {
      if (snapshot.status !== "listening") {
        transport.startListening();
        commit({ status: "listening" });
      }
      if (startOptions.sendPing) post(outgoing.ping());
    },
    postMessage: post,
    accept: (messages) => {
      for (const message of messages) transport.accept(message);
    },
    accept64: (message) => {
      let decoded: TIncomingMessage[];
      try {
        decoded = decodeIncomingMessages(message);
      } catch (error) {
        options.onDecodeError?.(error);
        return;
      }
      for (const entry of decoded) transport.accept(entry);
    },
    close: () => post(outgoing.close()),
    restore: () => {
      const result = restores.begin();
      post(outgoing.restore());
      return result;
    },
    openUrl: (url, urlOptions = {}) => post(outgoing.openUrl(url, urlOptions.browserType)),
    openExternalUrl: (url) => post(outgoing.openExternalUrl(url)),
    openDeepLink: (link) => post(outgoing.openDeepLink(link)),
    customPlacement: (name, params = {}) => post(outgoing.customPlacement(name, params)),
    requestStoreReview: (reviewType) => post(outgoing.requestStoreReview(reviewType)),
    pageView: (input) => post(outgoing.pageView(input)),
    hapticFeedback: (hapticType) => post(outgoing.hapticFeedback(hapticType)),
    requestPermission: (permissionType) => {
      const { requestId, result } = requests.permission(permissionType);
      post(outgoing.requestPermission(permissionType, requestId));
      return result;
    },
    requestCallback,
    purchase: (input, purchaseOptions = {}) => {
      const product = resolveProduct(input);
      const result = purchases.begin(product);
      commit({
        pendingPurchase: { reference: product.reference, product },
        lastPurchaseFailure: undefined,
      });
      post(
        outgoing.purchase(
          product,
          purchaseOptions.shouldDismiss ?? snapshot.config?.dismissOnPurchase,
        ),
      );
      return result;
    },
  };
};

// TProduct is the caller's claim about what host-delivered products look like;
// the host owns the values, so the claim is applied here, once.
export const createSuperwallSession = <TProduct extends SuperwallProduct = SuperwallProduct>(
  options: SuperwallSessionOptions = {},
): SuperwallSession<TProduct> => {
  const session: SuperwallSession = createSession(options);
  return session as SuperwallSession<TProduct>;
};

export { PING_VERSION, type PageViewInput } from "./outgoing";
export type { CallbackBehavior } from "./requests";
export {
  buildSuperwallState,
  type BuildSuperwallStateOptions,
  type SuperwallCallbackState,
  type SuperwallCallbackStates,
  type SuperwallPermissionStatuses,
  type SuperwallSdkState,
} from "./state";
export * from "./types";
export {
  recordFromVariables,
  type SuperwallCapability,
  type SuperwallCustomerInfo,
  type SuperwallDeviceEntitlement,
  type SuperwallDeviceTransaction,
  type SuperwallDeviceVariables,
  type SuperwallExperiment,
  type SuperwallPlacementParams,
  type SuperwallUserVariables,
} from "./variables";
