import {
  type TIncomingMessage,
  type TIncomingMessageCallbackResult,
  type TIncomingMessagePermissionResult,
  type TIncomingMessageTransactionAbandon,
  type TIncomingMessageTransactionComplete,
  type TOutgoingMessage,
  type TPermissionStatus,
  type TPermissionTypeMessage,
} from "@superwall/protocol";
import { getLocalizedPeriod } from "../localization/periods";
import { createSuperwallBridge, type SuperwallBridge } from "../bridge";
import { productsFromConfig, type SuperwallConfig } from "../config";
import {
  createTranslator,
  languageCandidates,
  resolveLocale,
  type SuperwallTranslateValues,
  type SuperwallTranslator,
} from "../localization";
import { recordFromVariables } from "./variables";
import {
  createSuperwallProduct,
  mergeIncomingProducts,
  mergeProductVariables,
  productReferenceFromInput,
  productVariablesFromTemplateVariables,
  productsByReference,
  type SuperwallProduct,
  type SuperwallProductInput,
} from "../products";
import { buildSuperwallState } from "./state";

import type {
  SuperwallCallbackResult,
  SuperwallEventMap,
  SuperwallEventName,
  SuperwallPurchaseFailure,
  SuperwallPurchaseOptions,
  SuperwallPurchaseResult,
  SuperwallRuntimeSnapshot,
  SuperwallSessionOptions,
  SuperwallSessionStartOptions,
  SuperwallTransaction,
  SuperwallTrialState,
} from "./types";

export * from "./types";

type Listener = () => void;

export type PageViewInput = {
  type: Extract<TOutgoingMessage, { event_name: "page_view" }>["type"];
  name: string;
  navigationId: string;
  position: number;
  previousName?: string;
  previousPosition?: number;
  timeOnPreviousMs?: number;
};

type PendingPurchase = {
  product: SuperwallProduct;
  resolve: (result: SuperwallPurchaseResult) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
};

type PendingPermission = {
  resolve: (status: TPermissionStatus) => void;
};

type PendingCallback<TData = Record<string, unknown>> = {
  name: string;
  resolve: (result: SuperwallCallbackResult<TData>) => void;
};

const permissionTypeToStateName = (permissionType: TPermissionTypeMessage): string =>
  permissionType.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const callbackNameToStateName = (name: string): string => {
  const segments = name
    .replace(/[^a-zA-Z0-9]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);

  if (segments.length === 0) {
    return "callback";
  }

  return segments
    .map((segment, index) =>
      index === 0
        ? segment.charAt(0).toLowerCase() + segment.slice(1)
        : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join("");
};

const initialTrialState = (config: SuperwallConfig | undefined): SuperwallTrialState => {
  switch (config?.introductoryOfferEligibility) {
    case "alwaysEligible":
      return { eligible: true };
    case "alwaysIneligible":
      return { eligible: false };
    default:
      return {};
  }
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mirrors the schema editor's computeTrialPeriodEndDate: "Jul 23, 2026",
 * month name localized to the active locale where the runtime supports it.
 */
const computeTrialPeriodEndDate = (
  trialPeriodDays: unknown,
  language: string | undefined,
): string | undefined => {
  const parsedDays =
    typeof trialPeriodDays === "number" ? trialPeriodDays : Number(trialPeriodDays);
  if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
    return undefined;
  }

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + Math.trunc(parsedDays));

  let month: string;
  try {
    month = endDate.toLocaleString(language?.replace(/_/g, "-") ?? "default", { month: "short" });
  } catch {
    month = endDate.toLocaleString("default", { month: "short" });
  }

  return `${month} ${endDate.getDate()}, ${endDate.getFullYear()}`;
};

const createRequestId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2)}`;
};

/**
 * The session's public contract, separated from the implementation so the
 * product generic can be declared covariant (`out`): `TProduct` appears in
 * output positions only, so a session refined with custom product variables
 * is always usable where a base session is expected (e.g. a shared React
 * context). The implementation is written against the base `SuperwallProduct`
 * — refinement happens once, in `createSuperwallSession`.
 */
export interface SuperwallSession<out TProduct extends SuperwallProduct = SuperwallProduct> {
  /**
   * Subscribes to a single incoming SDK event by name, or "message" for all
   * incoming messages. Returns an unsubscribe function.
   */
  on: <E extends SuperwallEventName>(
    event: E,
    handler: (payload: SuperwallEventMap[E]) => void,
  ) => () => void;
  /** Subscribes to snapshot changes (`useSyncExternalStore`-compatible). */
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SuperwallRuntimeSnapshot<TProduct>;
  readonly products: readonly TProduct[];
  readonly config: SuperwallConfig | undefined;
  readonly locale: string;
  /**
   * Resolves a message key for the active locale, interpolating `{name}`
   * params. Unknown keys return the key itself, so literal copy is safe.
   */
  t: (key: string, values?: SuperwallTranslateValues) => string;
  /** Overrides the locale (normally auto-detected from the device). */
  setLocale: (locale: string | undefined) => void;
  configure: (config: SuperwallConfig) => void;
  start: (options?: SuperwallSessionStartOptions) => void;
  postMessage: (message: TOutgoingMessage) => void;
  accept: (messages: TIncomingMessage[]) => void;
  accept64: (message: string) => void;
  ping: (message?: Partial<Extract<TOutgoingMessage, { event_name: "ping" }>>) => void;
  close: () => void;
  /**
   * Asks the SDK to restore purchases. The message protocol has no restore
   * result event; successful restores surface as `transaction_complete` or a
   * dismissed paywall.
   */
  restore: () => void;
  openUrl: (url: string, options?: { browserType?: "payment_sheet" }) => void;
  openExternalUrl: (url: string) => void;
  openDeepLink: (link: string) => void;
  custom: (data: string) => void;
  customPlacement: (name: string, params?: Record<string, unknown>) => void;
  requestStoreReview: (
    reviewType: Extract<TOutgoingMessage, { event_name: "request_store_review" }>["review_type"],
  ) => void;
  setUserAttributes: (attributes: Record<string, string>) => void;
  pageView: (input: PageViewInput) => void;
  scheduleTrialReminder: (input: {
    id: string;
    title: string;
    subtitle?: string;
    body: string;
    delayMs: number;
  }) => void;
  hapticFeedback: (
    hapticType: Extract<TOutgoingMessage, { event_name: "haptic_feedback" }>["haptic_type"],
  ) => void;
  requestPermission: (permissionType: TPermissionTypeMessage) => Promise<TPermissionStatus>;
  requestCallback: <TData extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    options?: {
      behavior?: "blocking" | "non-blocking";
      variables?: Record<string, unknown>;
    },
  ) => Promise<SuperwallCallbackResult<TData>>;
  /**
   * Starts a purchase and resolves with the outcome — never throws for flow
   * results: `{ status: "completed" | "abandoned" | "failed" }`.
   */
  purchase: (
    input: SuperwallProductInput,
    options?: SuperwallPurchaseOptions,
  ) => Promise<SuperwallPurchaseResult<TProduct>>;
  getProduct: (reference: string) => TProduct | undefined;
}

class SuperwallSessionImpl implements SuperwallSession {
  private bridge: SuperwallBridge;
  private listeners = new Set<Listener>();
  private pendingPurchases = new Map<string, PendingPurchase>();
  private pendingPermissions = new Map<string, PendingPermission>();
  private pendingCallbacks = new Map<string, PendingCallback>();
  private eventHandlers = new Map<SuperwallEventName, ReadonlySet<unknown>>();
  private snapshot: SuperwallRuntimeSnapshot;
  private translator: SuperwallTranslator;
  private localeOverride?: string;
  private rawProducts: readonly SuperwallProduct[];
  private localizedProductsCache?: {
    raw: readonly SuperwallProduct[];
    languages: string;
    products: readonly SuperwallProduct[];
  };

  constructor(options: SuperwallSessionOptions = {}) {
    this.bridge = options.bridge ?? createSuperwallBridge(options);
    const products = options.products ?? productsFromConfig(options.config);
    this.rawProducts = products;

    const variables = options.variables ?? {};
    const locale = resolveLocale(undefined, options.config?.localization);
    this.translator = createTranslator(options.config?.localization, locale);

    this.snapshot = {
      status: "idle",
      config: options.config,
      products,
      productsByReference: productsByReference(products),
      variables,
      device: {},
      user: {},
      params: {},
      trial: initialTrialState(options.config),
      locale,
      permissionStatuses: {},
      callbackStates: {},
      state: buildSuperwallState({ variables, products }),
      messages: [...this.bridge.messages],
    };

    this.bridge.addListener((message) => {
      this.handleIncomingMessage(message);
      this.emit(message.event_name, message);
      this.emit("message", message);
    });
  }

  /**
   * Subscribes to a single incoming SDK event by name, or "message" for all
   * incoming messages. Returns an unsubscribe function.
   */
  public on<E extends SuperwallEventName>(
    event: E,
    handler: (payload: SuperwallEventMap[E]) => void,
  ) {
    const handlers = this.handlersFor(event) ?? new Set<(payload: SuperwallEventMap[E]) => void>();
    this.eventHandlers.set(event, handlers);

    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  /**
   * `on`/`emit` enforce that handlers stored under an event name only ever
   * receive that event's payload; TypeScript cannot carry that key↔value
   * correlation through a heterogeneous store (microsoft/TypeScript#47109),
   * so this accessor is the one place it is asserted.
   */
  private handlersFor<E extends SuperwallEventName>(
    event: E,
  ): Set<(payload: SuperwallEventMap[E]) => void> | undefined {
    return this.eventHandlers.get(event) as
      | Set<(payload: SuperwallEventMap[E]) => void>
      | undefined;
  }

  private emit<E extends SuperwallEventName>(event: E, payload: SuperwallEventMap[E]) {
    const handlers = this.handlersFor(event);
    if (!handlers) return;

    for (const handler of handlers) {
      handler(payload);
    }
  }

  public subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = () => this.snapshot;

  public get products() {
    return this.snapshot.products;
  }

  public get config() {
    return this.snapshot.config;
  }

  public get locale() {
    return this.snapshot.locale;
  }

  /**
   * Resolves a message key for the active locale, interpolating `{name}`
   * params. Unknown keys return the key itself, so literal copy is safe.
   */
  public t = (key: string, values?: SuperwallTranslateValues): string =>
    this.translator.t(key, values);

  /** Overrides the locale (normally auto-detected from the device). */
  public setLocale(locale: string | undefined) {
    this.localeOverride = locale;
    this.patch({});
  }

  public configure(config: SuperwallConfig) {
    if (config === this.snapshot.config) {
      return;
    }

    const patch: Partial<SuperwallRuntimeSnapshot> = { config };

    // Reseed product slots from the new config unless the SDK has already
    // delivered real products (the SDK always wins over config seeds).
    const hasSdkProducts = this.rawProducts.some((product) => product.source === "sdk");
    if (!hasSdkProducts) {
      this.rawProducts = productsFromConfig(config);
    }

    // Re-derive forced trial eligibility; "automatic" keeps whatever the SDK
    // has signaled so far.
    if (
      config.introductoryOfferEligibility === "alwaysEligible" ||
      config.introductoryOfferEligibility === "alwaysIneligible"
    ) {
      patch.trial = initialTrialState(config);
    }

    this.patch(patch);
  }

  public start(options: SuperwallSessionStartOptions = {}) {
    if (this.snapshot.status !== "listening") {
      this.bridge.start();
      this.patch({ status: "listening" });
    }

    if (options.sendPing) {
      this.ping(options.ping);
    }
  }

  public postMessage(message: TOutgoingMessage) {
    this.bridge.postMessage(message);
    this.patch({ messages: this.bridge.messages });
  }

  public accept(messages: TIncomingMessage[]) {
    this.bridge.accept(messages);
  }

  public accept64(message: string) {
    this.bridge.accept64(message);
  }

  public ping(message: Partial<Extract<TOutgoingMessage, { event_name: "ping" }>> = {}) {
    this.postMessage({
      event_name: "ping",
      substitutions: [],
      page_styles: [],
      version: "4.0.0",
      ...message,
    });
  }

  public close() {
    this.postMessage({ event_name: "close" });
  }

  /**
   * Asks the SDK to restore purchases. The message protocol has no restore
   * result event, so this cannot resolve with an outcome; a successful restore
   * typically dismisses the paywall or arrives as `transaction_complete`
   * (observable via `on("transaction_complete", ...)`).
   */
  public restore() {
    this.postMessage({ event_name: "restore" });
  }

  public openUrl(url: string, options: { browserType?: "payment_sheet" } = {}) {
    this.postMessage({
      event_name: "open_url",
      url,
      browser_type: options.browserType,
    });
  }

  public openExternalUrl(url: string) {
    this.postMessage({
      event_name: "open_url_external",
      url,
    });
  }

  public openDeepLink(link: string) {
    this.postMessage({
      event_name: "open_deep_link",
      link,
    });
  }

  public custom(data: string) {
    this.postMessage({
      event_name: "custom",
      data,
    });
  }

  public customPlacement(name: string, params: Record<string, unknown> = {}) {
    this.postMessage({
      event_name: "custom_placement",
      name,
      params,
    });
  }

  public requestStoreReview(
    reviewType: Extract<TOutgoingMessage, { event_name: "request_store_review" }>["review_type"],
  ) {
    this.postMessage({
      event_name: "request_store_review",
      review_type: reviewType,
    });
  }

  public setUserAttributes(attributes: Record<string, string>) {
    this.postMessage({
      event_name: "user_attribute_updated",
      attributes: Object.entries(attributes).map(([key, value]) => ({
        key,
        value,
      })),
    });
  }

  public pageView(input: PageViewInput) {
    this.postMessage({
      event_name: "page_view",
      type: input.type,
      page_name: input.name,
      page_node_id: input.name,
      navigation_node_id: input.navigationId,
      flow_position: input.position,
      previous_page_node_id: input.previousName,
      previous_flow_position: input.previousPosition,
      time_on_previous_page_ms: input.timeOnPreviousMs,
    });
  }

  public scheduleTrialReminder(input: {
    id: string;
    title: string;
    subtitle?: string;
    body: string;
    delayMs: number;
  }) {
    this.postMessage({
      event_name: "schedule_notification",
      id: input.id,
      type: "TRIAL_STARTED",
      title: input.title,
      subtitle: input.subtitle,
      body: input.body,
      delay: input.delayMs,
    });
  }

  public hapticFeedback(
    hapticType: Extract<TOutgoingMessage, { event_name: "haptic_feedback" }>["haptic_type"],
  ) {
    this.postMessage({
      event_name: "haptic_feedback",
      haptic_type: hapticType,
    });
  }

  public requestPermission(permissionType: TPermissionTypeMessage): Promise<TPermissionStatus> {
    const requestId = createRequestId(`permission-${permissionType}`);

    const result = new Promise<TPermissionStatus>((resolve) => {
      this.pendingPermissions.set(requestId, { resolve });
    });

    this.postMessage({
      event_name: "request_permission",
      permission_type: permissionType,
      request_id: requestId,
    });

    return result;
  }

  public requestCallback<TData extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    options: {
      behavior?: "blocking" | "non-blocking";
      variables?: Record<string, unknown>;
    } = {},
  ): Promise<SuperwallCallbackResult<TData>> {
    const requestId = createRequestId(`callback-${name}`);
    const behavior = options.behavior ?? "blocking";

    const result = new Promise<SuperwallCallbackResult>((resolve) => {
      this.pendingCallbacks.set(requestId, { name, resolve });
    });

    this.postMessage({
      event_name: "request_callback",
      request_id: requestId,
      name,
      behavior,
      variables: options.variables,
    });

    // TData is the caller's claim about the SDK-owned payload — the same
    // unverifiable-claim seam as `createSuperwallSession`.
    return result as Promise<SuperwallCallbackResult<TData>>;
  }

  public purchase(
    input: SuperwallProductInput,
    options: SuperwallPurchaseOptions = {},
  ): Promise<SuperwallPurchaseResult> {
    const product = this.resolveProduct(input);
    const timeoutMs = options.timeoutMs ?? this.snapshot.config?.purchaseTimeoutMs;

    // A retry for the same product replaces the previous attempt: settle the
    // old promise and disarm its timer so it can't fire against the new one.
    this.cancelPendingPurchase(product.reference, "superseded");

    const result = new Promise<SuperwallPurchaseResult>((resolve) => {
      const pending: PendingPurchase = { product, resolve };

      if (timeoutMs !== undefined) {
        pending.timeoutId = setTimeout(() => {
          this.failPurchase(product.reference, "timeout");
        }, timeoutMs);
      }

      this.pendingPurchases.set(product.reference, pending);
    });

    this.patch({
      pendingPurchase: {
        reference: product.reference,
        product,
      },
      lastPurchaseFailure: undefined,
    });

    this.postMessage({
      event_name: "purchase",
      product: product.reference,
      product_identifier: product.productIdentifier ?? product.productId ?? product.id,
      should_dismiss: options.shouldDismiss ?? this.snapshot.config?.dismissOnPurchase,
    });

    return result;
  }

  public getProduct(reference: string) {
    return this.snapshot.productsByReference[reference];
  }

  private handleIncomingMessage(message: TIncomingMessage) {
    switch (message.event_name) {
      case "paywall_open":
        // A (re)presentation resets transaction state: settle any in-flight
        // purchases so their timers and promises can't leak into the new view.
        for (const reference of Array.from(this.pendingPurchases.keys())) {
          this.cancelPendingPurchase(reference, "superseded");
        }

        this.patch({
          paywall: {
            id: message.paywall_id,
            identifier: message.paywall_identifier,
          },
          pendingPurchase: undefined,
          lastTransaction: undefined,
          lastPurchaseFailure: undefined,
          messages: this.bridge.messages,
        });
        break;
      case "products":
        this.setProducts(mergeIncomingProducts(this.rawProducts, message.products));
        break;
      case "template_variables": {
        const productVariables = productVariablesFromTemplateVariables(message.variables);
        this.patch({
          variables: message.variables,
          device: recordFromVariables(message.variables, "device"),
          user: recordFromVariables(message.variables, "user"),
          params: recordFromVariables(message.variables, "params"),
          messages: this.bridge.messages,
        });

        if (productVariables.size > 0) {
          this.setProducts(mergeProductVariables(this.rawProducts, productVariables));
        }
        break;
      }
      case "template_substitutions_prefix": {
        // The SDK signals introductory-offer eligibility by switching the
        // substitutions prefix to "freeTrial". Config overrides win.
        if (this.snapshot.config?.introductoryOfferEligibility === "alwaysEligible") break;
        if (this.snapshot.config?.introductoryOfferEligibility === "alwaysIneligible") break;

        this.patch({
          trial: { eligible: message.prefix === "freeTrial" },
          messages: this.bridge.messages,
        });
        break;
      }
      case "experiment":
        this.patch({
          experiment: {
            experimentId: message.experimentId,
            variantId: message.variantId,
            campaignId: message.campaignId,
          },
          messages: this.bridge.messages,
        });
        break;
      case "freeTrial_start":
        this.scheduleConfiguredTrialReminder(message);
        this.patch({ messages: this.bridge.messages });
        break;
      case "transaction_complete":
        this.resolvePurchase(message);
        break;
      case "transaction_abandon":
        this.resolvePurchase(message);
        break;
      case "permission_result":
        this.resolvePermission(message);
        break;
      case "callback_result":
        this.resolveCallback(message);
        break;
      default:
        this.patch({ messages: this.bridge.messages });
        break;
    }
  }

  /**
   * Auto-schedules the config's trial reminder when the SDK reports a trial
   * started. Static configs run title/subtitle/body through `t()`; dynamic
   * configs (functions) compute the notification from the trial context.
   */
  private scheduleConfiguredTrialReminder(
    message: Extract<TIncomingMessage, { event_name: "freeTrial_start" }>,
  ) {
    const reminder = this.snapshot.config?.notifications?.trialReminder;
    if (!reminder) return;
    if (!message.trial_end_date) return;

    const trialEndMs =
      typeof message.trial_end_date === "number"
        ? message.trial_end_date
        : Date.parse(message.trial_end_date);
    if (Number.isNaN(trialEndMs)) return;

    let notification: { title: string; subtitle?: string; body: string; delayMs: number };

    if (typeof reminder === "function") {
      const product = message.product_identifier
        ? this.rawProducts.find(
            (candidate) =>
              candidate.productIdentifier === message.product_identifier ||
              candidate.productId === message.product_identifier,
          )
        : undefined;

      const resolved = reminder({
        trialEndDate: new Date(trialEndMs),
        productIdentifier: message.product_identifier,
        product,
        t: this.t,
        locale: this.snapshot.locale,
      });

      if (!resolved) return;
      notification = resolved;
    } else {
      if (reminder.enabled === false) return;

      const beforeTrialEndDays = reminder.beforeTrialEndDays ?? 1;
      notification = {
        title: this.t(reminder.title),
        subtitle: reminder.subtitle ? this.t(reminder.subtitle) : undefined,
        body: this.t(reminder.body),
        delayMs: trialEndMs - beforeTrialEndDays * DAY_MS - Date.now(),
      };
    }

    if (notification.delayMs <= 0) return;

    this.postMessage({
      event_name: "schedule_notification",
      id: `${this.snapshot.paywall?.identifier ?? "paywall"}_TRIAL_STARTED`,
      type: "TRIAL_STARTED",
      title: notification.title,
      subtitle: notification.subtitle,
      body: notification.body,
      delay: notification.delayMs,
    });
  }

  private setProducts(products: readonly SuperwallProduct[]) {
    this.rawProducts = products;
    this.patch({ messages: this.bridge.messages });
  }

  /**
   * The runtime's derived-variables layer — the headless equivalent of the
   * schema editor's buildStateIndex computeds. Raw SDK values are kept
   * internally; every snapshot derives from them so locale changes re-derive
   * cleanly. Currently derives:
   * - `period` / `periodly` localized with the shared translation table
   * - `trialPeriodEndDate` from `trialPeriodDays` when the SDK omits it
   */
  private deriveProducts(
    raw: readonly SuperwallProduct[],
    languages: readonly string[],
  ): readonly SuperwallProduct[] {
    const cacheKey = languages.join(",");
    if (
      this.localizedProductsCache &&
      this.localizedProductsCache.raw === raw &&
      this.localizedProductsCache.languages === cacheKey
    ) {
      return this.localizedProductsCache.products;
    }

    const products = raw.map((product) => {
      const { period, periodly, trialPeriodDays, trialPeriodEndDate } = product.variables;
      const derivedEndDate =
        trialPeriodEndDate === undefined
          ? computeTrialPeriodEndDate(trialPeriodDays, languages[0])
          : undefined;

      if (
        typeof period !== "string" &&
        typeof periodly !== "string" &&
        derivedEndDate === undefined
      ) {
        return product;
      }

      return {
        ...product,
        variables: {
          ...product.variables,
          ...(typeof period === "string"
            ? { period: getLocalizedPeriod(period, [...languages]) }
            : {}),
          ...(typeof periodly === "string"
            ? { periodly: getLocalizedPeriod(periodly, [...languages]) }
            : {}),
          ...(derivedEndDate !== undefined ? { trialPeriodEndDate: derivedEndDate } : {}),
        },
      };
    });

    this.localizedProductsCache = { raw, languages: cacheKey, products };
    return products;
  }

  private resolveProduct(input: SuperwallProductInput): SuperwallProduct {
    const reference = productReferenceFromInput(input);
    const existing = this.snapshot.productsByReference[reference];

    if (existing) {
      return existing;
    }

    return createSuperwallProduct(input);
  }

  private resolveProductFromTransaction(
    message: TIncomingMessageTransactionComplete | TIncomingMessageTransactionAbandon,
  ): SuperwallProduct {
    if (message.product) {
      return this.resolveProduct(message.product);
    }

    if (message.product_identifier) {
      const product = this.snapshot.products.find(
        (candidate) =>
          candidate.productIdentifier === message.product_identifier ||
          candidate.productId === message.product_identifier ||
          candidate.id === message.product_identifier,
      );

      if (product) {
        return product;
      }
    }

    return createSuperwallProduct(message.product_identifier ?? message.product ?? "unknown");
  }

  /**
   * Attributes a transaction message to a pending purchase. Explicit product
   * info on the message must match the pending purchase — an unrelated
   * transaction (e.g. a restore completing another product) must not resolve
   * it. Only a bare transaction with a single pending purchase falls back to
   * that purchase, since some SDK versions omit product info.
   */
  private pendingPurchaseForTransaction(
    message: TIncomingMessageTransactionComplete | TIncomingMessageTransactionAbandon,
  ): PendingPurchase | undefined {
    if (message.product) {
      return this.pendingPurchases.get(message.product);
    }

    if (message.product_identifier) {
      for (const pending of this.pendingPurchases.values()) {
        if (
          pending.product.productIdentifier === message.product_identifier ||
          pending.product.productId === message.product_identifier ||
          pending.product.id === message.product_identifier
        ) {
          return pending;
        }
      }
      return undefined;
    }

    return this.pendingPurchases.size === 1 ? this.firstPendingPurchase() : undefined;
  }

  private resolvePurchase(
    message: TIncomingMessageTransactionComplete | TIncomingMessageTransactionAbandon,
  ) {
    const pending = this.pendingPurchaseForTransaction(message);
    const product = pending?.product ?? this.resolveProductFromTransaction(message);
    const result: SuperwallTransaction =
      message.event_name === "transaction_complete"
        ? { status: "completed", product, message }
        : { status: "abandoned", product, message };

    if (pending) {
      if (pending.timeoutId !== undefined) {
        clearTimeout(pending.timeoutId);
      }
      this.pendingPurchases.delete(pending.product.reference);
      pending.resolve(result);
    }

    const clearsSnapshotPending =
      pending !== undefined &&
      this.snapshot.pendingPurchase?.reference === pending.product.reference;

    this.patch({
      pendingPurchase: clearsSnapshotPending ? undefined : this.snapshot.pendingPurchase,
      lastTransaction: result,
      lastPurchaseFailure: undefined,
      messages: this.bridge.messages,
    });
  }

  private failPurchase(reference: string, reason: SuperwallPurchaseFailure["reason"]) {
    const failure = this.cancelPendingPurchase(reference, reason);
    if (!failure) return;

    this.patch({
      pendingPurchase:
        this.snapshot.pendingPurchase?.reference === reference
          ? undefined
          : this.snapshot.pendingPurchase,
      lastPurchaseFailure: failure,
    });
  }

  /**
   * Settles and removes a pending purchase as failed without touching the
   * snapshot. Returns the failure, or undefined if nothing was pending.
   */
  private cancelPendingPurchase(
    reference: string,
    reason: SuperwallPurchaseFailure["reason"],
  ): SuperwallPurchaseFailure | undefined {
    const pending = this.pendingPurchases.get(reference);
    if (!pending) return undefined;

    if (pending.timeoutId !== undefined) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingPurchases.delete(reference);

    const failure: SuperwallPurchaseFailure = {
      status: "failed",
      product: pending.product,
      reason,
    };

    pending.resolve(failure);
    return failure;
  }

  private firstPendingPurchase() {
    for (const pending of this.pendingPurchases.values()) {
      return pending;
    }

    return undefined;
  }

  private resolvePermission(message: TIncomingMessagePermissionResult) {
    const pending = this.pendingPermissions.get(message.request_id);

    if (pending) {
      this.pendingPermissions.delete(message.request_id);
      pending.resolve(message.status);
    }

    this.patch({
      permissionStatuses: {
        ...this.snapshot.permissionStatuses,
        [permissionTypeToStateName(message.permission_type)]: message.status,
      },
      messages: this.bridge.messages,
    });
  }

  private resolveCallback(message: TIncomingMessageCallbackResult) {
    const pending = this.pendingCallbacks.get(message.request_id);
    const callbackName = callbackNameToStateName(pending?.name ?? message.name);

    if (pending) {
      this.pendingCallbacks.delete(message.request_id);
      pending.resolve({
        status: message.status,
        data: message.data,
        message,
      });
    }

    this.patch({
      callbackStates: {
        ...this.snapshot.callbackStates,
        [callbackName]: {
          result: message.status,
          data: message.data,
        },
      },
      messages: this.bridge.messages,
    });
  }

  private patch(patch: Partial<SuperwallRuntimeSnapshot>) {
    const nextSnapshot = {
      ...this.snapshot,
      ...patch,
    };

    // The bridge's log is one mutable array; snapshots must be immutable
    // views of it. Copy when it grew, keep the previous copy otherwise so
    // memoized consumers see a stable identity.
    nextSnapshot.messages =
      this.bridge.messages.length === this.snapshot.messages.length
        ? this.snapshot.messages
        : [...this.bridge.messages];

    const deviceLocale = nextSnapshot.device.deviceLocale ?? nextSnapshot.device.deviceLanguageCode;
    const requestedLocale =
      this.localeOverride ?? (typeof deviceLocale === "string" ? deviceLocale : undefined);
    const locale = resolveLocale(requestedLocale, nextSnapshot.config?.localization);

    if (locale !== this.translator.locale || nextSnapshot.config !== this.snapshot.config) {
      this.translator = createTranslator(nextSnapshot.config?.localization, locale);
    }

    const products = this.deriveProducts(this.rawProducts, languageCandidates(requestedLocale));
    if (products !== nextSnapshot.products) {
      nextSnapshot.products = products;
      nextSnapshot.productsByReference = productsByReference(products);
    }

    this.snapshot = {
      ...nextSnapshot,
      locale,
      state: buildSuperwallState({
        variables: nextSnapshot.variables,
        products: nextSnapshot.products,
        paywall: nextSnapshot.paywall,
        lastTransaction: nextSnapshot.lastTransaction,
        permissionStatuses: nextSnapshot.permissionStatuses,
        callbackStates: nextSnapshot.callbackStates,
        trial: nextSnapshot.trial,
      }),
    };

    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * Creates a runtime session.
 *
 * `TProduct` is the caller's declaration of what SDK-delivered products look
 * like (custom template variables layered over the known ones). The runtime
 * cannot verify it — the SDK owns the values — so this downcast is the single
 * seam where the claim is applied; every refined type downstream derives from
 * it.
 */
export const createSuperwallSession = <TProduct extends SuperwallProduct = SuperwallProduct>(
  options: SuperwallSessionOptions<TProduct> = {},
): SuperwallSession<TProduct> => {
  const session: SuperwallSession = new SuperwallSessionImpl(options);
  return session as SuperwallSession<TProduct>;
};
