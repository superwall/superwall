import {
  dismissesOnPurchase,
  teleportOf,
  type ResolvedTeleport,
  type SuperwallPostPurchase,
  type SuperwallRuntimeSnapshot,
  type SuperwallSession,
} from "@superwall/runtime";
import { platformOf } from "../../device";
import { attributionOf } from "../api/body";
import { attachCheckoutMetadata } from "../api/metadata";
import { asString } from "../api/decode";
import { checkoutEvents } from "../events";
import { hostedInWebSdk } from "../host/surface";
import { startLoading, stopLoading } from "../loading";
import { isStripeProductIdentifier } from "../products";
import type { PurchaseOutcome } from "../types";
import {
  completeTeleportCheckout,
  createTeleport,
  moveTeleportIntroductoryOffer,
  readCheckoutOf,
  readTeleportQuery,
  readTeleportStatus,
  saveTeleportQuery,
  teleportStatusUrls,
  warmTeleportPage,
  type CreatedTeleport,
} from "./api";
import {
  encodeQueryPatch,
  INTRODUCTORY_OFFER_FRAGMENT_KEY,
  NAV_QUERY_KEY,
  QUERY_FRAGMENT_KEY,
  readTeleportBoot,
  TAPPED_PRODUCT_FRAGMENT_KEY,
  type TeleportBoot,
} from "./boot";
import { teleportCopyFor } from "./copy";
import { createTeleportScreen, poweredByHref, type TeleportScreen } from "./screen";

export const TELEPORT_SDK_VERSION = "004.018.000";
export const TELEPORT_TTL_MS = 30 * 60 * 1000;
const CLAIMED_WAIT_MS = 2 * TELEPORT_TTL_MS;
const PREPARED_FRESH_MS = 10 * 60 * 1000;
const FAST_POLL_MS = 2_000;
const FAST_POLL_WINDOW_MS = 2 * 60 * 1000;
const SLOW_POLL_MS = 5_000;
const LATE_PAYMENT_WATCH_MS = 5 * 60 * 1000;
const LATE_PAYMENT_POLL_MS = 5_000;
const LATE_PAYMENT_FAST_WINDOW_MS = 15_000;
const RETURN_GRACE_MS = 15_000;
const SESSION_SAVE_TIMEOUT_MS = 1_500;
const WAITING_FALLBACK_MS = 1_500;
const PAINT_WAIT_MS = 250;
const PARKED_TAP_CHECK_MS = 1_500;
const QUERY_FRAGMENT_LIMIT = 2_048;
const PAGE_WATCH_MS = 5_000;
const PAGE_COMPLETE_WAIT_MS = 8_000;
const PAGE_TAP_CHECK_MS = 1_500;
const PAGE_TAP_LOADER_DELAY_MS = 200;
export const APP_OPEN_WAIT_MS = 1_000;
const TAPPED_PRODUCT_QUERY_KEY = "sw_ref";

export type TeleportStatus =
  | { status: "idle" }
  | { status: "waiting"; productReference?: string; returned: boolean }
  | { status: "arrived"; productReference?: string }
  | { status: "completed"; productReference?: string; paidElsewhere: boolean };

export type TeleportEvent = "open" | "return" | "cancel" | "complete";

export type HandedOff = { reference: string; result: Promise<{ status: PurchaseOutcome }> };

export type TeleportOutcome = PurchaseOutcome | HandedOff;

export type TeleportRequest = {
  route?: string;
  productReference?: string;
  query: Record<string, string>;
  postPurchase?: SuperwallPostPurchase;
  stripeMetadata?: Readonly<Record<string, string>>;
};

export type ReturnReason = "purchased" | "closed";

export type Teleporter = {
  getStatus(): TeleportStatus;
  subscribe(listener: () => void): () => void;
  on(event: TeleportEvent, handler: () => void): () => void;
  available(): boolean;
  landed(route: string): void;
  begin(request: TeleportRequest): Promise<TeleportOutcome>;
  prefetch(route?: string, query?: Record<string, string>): void;
  beginPresentation(presentationId?: string): void;
  endPresentation(): void;
  refreshIntroductoryOffer(): void;
  inFlight(): boolean;
  handOff<T extends { status: PurchaseOutcome }>(
    reference: string,
    purchase: () => Promise<T>,
  ): Promise<T>;
  open(): void;
  cancel(): void;
  fallback(): string | undefined;
  showWaitingScreen(): Promise<boolean>;
  handleReturn(reason?: string): Promise<boolean>;
  whenUnsettled(): Promise<boolean>;
  checkSettled(atBoot?: boolean): Promise<boolean>;
  watchPresentation(): () => void;
  completePurchase(checkoutContextId: string): Promise<void>;
  followFragment(): void;
  returnToApp(reason?: ReturnReason): void;
  attach(session: AttachedSession): () => void;
};

export type TeleportSession = Pick<SuperwallSession, "getSnapshot" | "postMessage">;

export type AttachedSession = Pick<
  SuperwallSession,
  "getSnapshot" | "postMessage" | "purchase" | "on"
>;

type OpenTeleport = CreatedTeleport & {
  route: string;
  createdAt: number;
  queryBase: Record<string, string>;
  productReference?: string;
  productIdentifier: string;
  freeTrial: boolean;
  checkoutContextId?: string;
  checkoutProductIdentifier?: string;
  returnedAt?: number;
  queryPatch?: string;
  postPurchase?: SuperwallPostPurchase;
  stripeMetadata?: Readonly<Record<string, string>>;
  paid?: boolean;
  outcome: Promise<TeleportOutcome>;
  settle: (outcome: TeleportOutcome) => void;
};

type ParkedTeleport = OpenTeleport & { parkedAt: number; watchUntil: number; reuseUntil: number };

type ParkedState = "paid" | "open" | "closed" | "unknown";

type Phase =
  | { kind: "idle" }
  | { kind: "waiting"; record: OpenTeleport }
  | { kind: "parked"; record: ParkedTeleport };

type Prepared = {
  route: string;
  freeTrial: boolean;
  createdAt: number;
  query: Record<string, string>;
  teleport: Promise<Created | undefined>;
};

type Created = CreatedTeleport & {
  route: string;
  freeTrial: boolean;
  queryBase: Record<string, string>;
};

export const flowQuery = (
  store: { entries(): Record<string, string> } | null,
): Record<string, string> => {
  const { [NAV_QUERY_KEY]: _nav, ...query } = store?.entries() ?? {};
  return query;
};

type QueryWriter = {
  get(key: string): string | null;
  set(patch: Record<string, string>, history: "replace"): void;
};

export const restoreTeleportQuery = async (
  boot: TeleportBoot,
  publicApiKey: string,
  store: QueryWriter,
): Promise<void> => {
  let saved: Record<string, string>;
  try {
    saved = await readTeleportQuery(publicApiKey, boot.id);
  } catch (error) {
    console.warn("Reading the flow the app saved for this teleport failed:", error);
    return;
  }
  const missing = Object.entries(saved).filter(([key]) => store.get(key) === null);
  if (missing.length > 0) store.set(Object.fromEntries(missing), "replace");
};

const changedQuery = (
  saved: Record<string, string>,
  now: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(now).filter(([key, value]) => saved[key] !== value));

let opens = 0;

export const checkoutUrlFor = (
  url: string,
  productReference: string | undefined,
  queryPatch?: string,
  freeTrial?: boolean,
): string => {
  const next = new URL(url);
  opens += 1;
  next.hash = new URLSearchParams({
    ...(productReference === undefined ? {} : { [TAPPED_PRODUCT_FRAGMENT_KEY]: productReference }),
    o: `${Date.now().toString(36)}${opens.toString(36)}`,
    ...(queryPatch === undefined ? {} : { [QUERY_FRAGMENT_KEY]: queryPatch }),
    ...(freeTrial === undefined
      ? {}
      : { [INTRODUCTORY_OFFER_FRAGMENT_KEY]: freeTrial ? "1" : "0" }),
  }).toString();
  return next.toString();
};

const withTappedProduct = (url: string, productReference: string | undefined): string => {
  if (productReference === undefined) return url;
  const next = new URL(url);
  if (!next.searchParams.has(TAPPED_PRODUCT_QUERY_KEY)) {
    next.searchParams.set(TAPPED_PRODUCT_QUERY_KEY, productReference);
  }
  return next.toString();
};

const withReason = (link: string, reason: ReturnReason | undefined): string => {
  if (reason === undefined) return link;
  const url = new URL(link);
  url.searchParams.set("reason", reason);
  return url.toString();
};

export const pageNavigation = {
  assign: (url: string) => {
    window.location.href = url;
  },
  replace: (url: string) => {
    window.location.replace(url);
  },
};

const fallBackToScheme = (boot: TeleportBoot, reason?: ReturnReason): void => {
  const scheme = boot.returnUrl;
  if (scheme === undefined || (boot.appLinkUrl ?? scheme) === scheme) return;
  let opened = false;
  const leave = () => {
    if (document.visibilityState === "hidden") opened = true;
  };
  const hide = () => {
    opened = true;
  };
  document.addEventListener("visibilitychange", leave);
  window.addEventListener("pagehide", hide);
  setTimeout(() => {
    document.removeEventListener("visibilitychange", leave);
    window.removeEventListener("pagehide", hide);
    if (!opened && document.visibilityState === "visible") {
      pageNavigation.assign(withReason(scheme, reason));
    }
  }, APP_OPEN_WAIT_MS);
};

export const openApp = (boot: TeleportBoot, reason?: ReturnReason): boolean => {
  const link = boot.appLinkUrl ?? boot.returnUrl;
  if (link === undefined) return false;
  pageNavigation.assign(withReason(link, reason));
  fallBackToScheme(boot, reason);
  return true;
};

const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

export const painted = (): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, PAINT_WAIT_MS);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });

const freeTrialFor = (resolved: ResolvedTeleport, snapshot: SuperwallRuntimeSnapshot): boolean => {
  if (resolved.introductoryOfferEligibility === "eligible") return true;
  if (resolved.introductoryOfferEligibility === "ineligible") return false;
  return snapshot.introductoryOffer.eligible === true;
};

const stripeReferences = (snapshot: SuperwallRuntimeSnapshot): string[] =>
  snapshot.products
    .filter((product) => isStripeProductIdentifier(product.productId))
    .map((product) => product.reference);

const createTeleporter = (paywall: TeleportSession): Teleporter => {
  const listeners = new Set<() => void>();
  const handlers = new Map<TeleportEvent, Set<() => void>>();
  const boot = readTeleportBoot();
  let phase: Phase = { kind: "idle" };
  let shown = false;
  let pageStatus: TeleportStatus =
    boot === undefined
      ? { status: "idle" }
      : {
          status: "arrived",
          ...(boot.productReference === undefined
            ? {}
            : { productReference: boot.productReference }),
        };
  let status: TeleportStatus = pageStatus;
  let tapped = boot?.productReference;
  let prepared: Prepared | undefined;
  let starting: Promise<TeleportOutcome> | undefined;
  let route: string | undefined;
  let presentationId: string = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling: OpenTeleport | undefined;
  let parkedCheck: { record: ParkedTeleport; promise: Promise<ParkedState> } | undefined;
  let overlay: TeleportScreen | undefined;
  let waitAway: (() => void) | undefined;
  let returnLoading = false;
  let settled = false;
  let pageCheck: Promise<boolean> | undefined;
  let pageCheckedAt = 0;

  const settings = () => teleportOf(paywall.getSnapshot().config?.teleport);
  const publicApiKey = () => asString(paywall.getSnapshot().device.publicApiKey);
  const post = paywall.postMessage;

  const emit = (event: TeleportEvent) => {
    for (const handler of handlers.get(event) ?? []) handler();
  };

  const statusOfPhase = (): TeleportStatus => {
    if (boot !== undefined) return pageStatus;
    if (phase.kind !== "waiting") return { status: "idle" };
    const record = phase.record;
    const returned = record.returnedAt !== undefined;
    if (!shown && !returned) return { status: "idle" };
    return {
      status: "waiting",
      returned,
      ...(record.productReference === undefined
        ? {}
        : { productReference: record.productReference }),
    };
  };

  const publish = () => {
    const next = statusOfPhase();
    if (JSON.stringify(next) === JSON.stringify(status)) return;
    status = next;
    for (const listener of listeners) listener();
  };

  const setPageStatus = (next: TeleportStatus) => {
    pageStatus = next;
    status = next;
    for (const listener of listeners) listener();
  };

  const isWaiting = (record: OpenTeleport) => phase.kind === "waiting" && phase.record === record;
  const isParked = (record: ParkedTeleport) => phase.kind === "parked" && phase.record === record;

  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const cancelWaitAway = () => {
    waitAway?.();
    waitAway = undefined;
  };

  let purchaseInApp: AttachedSession["purchase"] | undefined;

  const fallbackFor = (record: OpenTeleport): string | undefined => {
    const reference = record.productReference;
    if (reference === undefined) return undefined;
    const candidate = settings()?.fallbacks[reference];
    if (candidate === undefined) return undefined;
    const product = paywall.getSnapshot().productsByReference[candidate];
    return product?.productId && product.variables.price ? candidate : undefined;
  };

  const inAppOfferFor = (
    record: OpenTeleport,
  ): { reference: string; buy: AttachedSession["purchase"] } | undefined => {
    const buy = purchaseInApp;
    if (buy === undefined) return undefined;
    const reference = fallbackFor(record);
    return reference === undefined ? undefined : { reference, buy };
  };

  const drawOverlay = (record: OpenTeleport, instant: boolean) => {
    if (overlay !== undefined) return;
    const copy = teleportCopyFor(asString(paywall.getSnapshot().device.deviceLocale) || undefined);
    const withHaptic = (action: () => void) => () => {
      post({ event_name: "haptic_feedback", haptic_type: "light" });
      action();
    };
    const inApp = inAppOfferFor(record);
    overlay = createTeleportScreen({
      surface: "overlay",
      role: "dialog",
      title: copy.waiting.title,
      body: copy.waiting.body,
      dir: copy.dir ?? "ltr",
      spinner: true,
      instant,
      actions: [
        {
          label: copy.waiting.continue,
          kind: "primary",
          onClick: withHaptic(() => teleporter.open()),
        },
        ...(inApp === undefined
          ? []
          : [
              {
                label: copy.waiting.payInApp,
                kind: "tinted" as const,
                onClick: withHaptic(() => payInApp(record, inApp)),
              },
            ]),
        {
          label: copy.waiting.cancel,
          kind: "secondary",
          onClick: withHaptic(() => teleporter.cancel()),
        },
      ],
    });
  };

  const show = (record: OpenTeleport, instant: boolean) => {
    cancelWaitAway();
    if (!shown) {
      shown = true;
      post({
        event_name: "teleport_watch_start",
        teleport_id: record.teleportId,
        ...teleportStatusUrls(),
        public_api_key: publicApiKey(),
      });
    }
    if (settings()?.overlay) drawOverlay(record, instant);
    publish();
  };

  const hide = (instant: boolean): boolean => {
    cancelWaitAway();
    const drawn = overlay;
    overlay = undefined;
    drawn?.remove({ instant });
    if (!shown) return false;
    shown = false;
    post({ event_name: "teleport_watch_end" });
    publish();
    return drawn !== undefined;
  };

  const showOnceAway = (record: OpenTeleport) => {
    cancelWaitAway();
    const away = () => {
      if (document.visibilityState === "hidden") show(record, true);
    };
    document.addEventListener("visibilitychange", away);
    const fallbackTimer = setTimeout(
      () => show(record, document.visibilityState === "hidden"),
      WAITING_FALLBACK_MS,
    );
    waitAway = () => {
      document.removeEventListener("visibilitychange", away);
      clearTimeout(fallbackTimer);
    };
  };

  const stop = () => {
    clearTimer();
    hide(false);
    phase = { kind: "idle" };
    publish();
  };

  const stopParked = () => {
    phase = { kind: "idle" };
    clearTimer();
    publish();
  };

  const schedulePoll = (record: OpenTeleport, delay: number) => {
    clearTimer();
    timer = setTimeout(() => void poll(record), delay);
  };

  const scheduleParkedCheck = (record: ParkedTeleport, delay: number) => {
    clearTimer();
    timer = setTimeout(() => void checkParked(record, true), delay);
  };

  const redeem = (record: OpenTeleport, checkoutContextId: string, productIdentifier?: string) => {
    record.paid = true;
    const dismiss = dismissesOnPurchase(
      record.postPurchase ?? paywall.getSnapshot().config?.postPurchase,
    );
    if (record.stripeMetadata !== undefined) {
      attachCheckoutMetadata(publicApiKey(), checkoutContextId, record.stripeMetadata).catch(
        (error: unknown) => console.error("Attaching checkout metadata failed:", error),
      );
    }
    post({
      event_name: "stripe_checkout_complete",
      checkout_context_id: checkoutContextId,
      product_identifier:
        productIdentifier ??
        (checkoutContextId === record.checkoutContextId && record.checkoutProductIdentifier
          ? record.checkoutProductIdentifier
          : record.productIdentifier),
      should_dismiss: dismiss ?? true,
    });
    record.settle("completed");
    emit("complete");
  };

  const settleAbandoned = (record: OpenTeleport) => {
    stop();
    post({
      event_name: "stripe_checkout_abandon",
      checkout_context_id: record.checkoutContextId ?? record.teleportId,
      product_identifier: record.productIdentifier,
    });
    record.settle("abandoned");
    emit("cancel");
    prepare();
  };

  const park = (record: OpenTeleport) => {
    const now = Date.now();
    const parked: ParkedTeleport = {
      ...record,
      parkedAt: now,
      watchUntil: now + LATE_PAYMENT_WATCH_MS,
      reuseUntil: now + TELEPORT_TTL_MS,
    };
    phase = { kind: "parked", record: parked };
    publish();
    scheduleParkedCheck(parked, FAST_POLL_MS);
  };

  const parkWaiting = (): OpenTeleport | undefined => {
    if (phase.kind !== "waiting") return undefined;
    const record = phase.record;
    hide(false);
    park(record);
    return record;
  };

  const cancel = (record: OpenTeleport) => {
    settleAbandoned(record);
    park(record);
  };

  const payInApp = (
    record: OpenTeleport,
    { reference, buy }: { reference: string; buy: AttachedSession["purchase"] },
  ) => {
    hide(false);
    park(record);
    record.settle({ reference, result: buy(reference) });
  };

  const poll = async (record: OpenTeleport) => {
    if (polling === record) return;
    const key = publicApiKey();
    polling = record;
    let checked = false;
    try {
      const teleport = await readTeleportStatus(key, record.teleportId);
      if (!isWaiting(record)) return;
      if (teleport.checkoutContextId && teleport.checkoutContextId !== record.checkoutContextId) {
        record.checkoutContextId = teleport.checkoutContextId;
        record.checkoutProductIdentifier =
          teleport.checkoutProductIdentifier ?? record.productIdentifier;
      }
      if (teleport.status === "completed" && teleport.checkoutContextId) {
        stop();
        redeem(record, teleport.checkoutContextId, teleport.checkoutProductIdentifier);
        return;
      }
      if (record.checkoutContextId) {
        const checkout = await readCheckoutOf(key, record.checkoutContextId);
        if (!isWaiting(record)) return;
        if (checkout === "completed") {
          stop();
          redeem(record, record.checkoutContextId);
          return;
        }
      }
      if (teleport.status === "expired") {
        settleAbandoned(record);
        return;
      }
      checked = true;
    } catch (error) {
      console.warn("Checking the web checkout failed; retrying:", error);
    } finally {
      if (polling === record) polling = undefined;
      if (returnLoading) {
        returnLoading = false;
        stopLoading();
      }
    }
    if (!isWaiting(record)) return;
    const age = Date.now() - record.createdAt;
    if (age >= (record.checkoutContextId ? CLAIMED_WAIT_MS : TELEPORT_TTL_MS)) {
      settleAbandoned(record);
      return;
    }
    if (record.returnedAt !== undefined) {
      if (checked && Date.now() - record.returnedAt >= RETURN_GRACE_MS) cancel(record);
      else schedulePoll(record, FAST_POLL_MS);
      return;
    }
    schedulePoll(record, age < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS);
  };

  const runParkedCheck = async (record: ParkedTeleport, fromTimer: boolean) => {
    const now = Date.now();
    if (now > record.reuseUntil && now > record.watchUntil) {
      stopParked();
      return "closed";
    }
    const key = publicApiKey();
    let state: ParkedState = "unknown";
    try {
      const teleport = await readTeleportStatus(key, record.teleportId);
      const checkoutContextId = teleport.checkoutContextId ?? record.checkoutContextId;
      if (isParked(record) && teleport.status === "completed" && teleport.checkoutContextId) {
        stopParked();
        redeem(record, teleport.checkoutContextId, teleport.checkoutProductIdentifier);
        return "paid";
      }
      if (isParked(record) && checkoutContextId) {
        const checkout = await readCheckoutOf(key, checkoutContextId);
        if (isParked(record) && checkout === "completed") {
          stopParked();
          redeem(record, checkoutContextId, teleport.checkoutProductIdentifier);
          return "paid";
        }
      }
      state = teleport.status === "pending" || teleport.status === "claimed" ? "open" : "closed";
    } catch (error) {
      console.warn("Checking for a late web payment failed; retrying:", error);
    }
    if (state === "closed") stopParked();
    else if (Date.now() < record.watchUntil) {
      const fast = Date.now() - record.parkedAt < LATE_PAYMENT_FAST_WINDOW_MS;
      scheduleParkedCheck(record, fast ? FAST_POLL_MS : LATE_PAYMENT_POLL_MS);
    } else if (fromTimer) clearTimer();
    return state;
  };

  const checkParked = (record: ParkedTeleport, fromTimer = false): Promise<ParkedState> => {
    if (parkedCheck?.record === record) return parkedCheck.promise;
    const promise = runParkedCheck(record, fromTimer).finally(() => {
      if (parkedCheck?.promise === promise) parkedCheck = undefined;
    });
    parkedCheck = { record, promise };
    return promise;
  };

  const open = (record: OpenTeleport) => {
    record.returnedAt = undefined;
    post({
      event_name: "open_url_external",
      url: checkoutUrlFor(record.url, record.productReference, record.queryPatch, record.freeTrial),
      teleport: true,
      ...(settings()?.overlay && overlay === undefined ? { waiting_screen: true } : {}),
    });
    publish();
    emit("open");
  };

  const create = async (
    resolved: ResolvedTeleport,
    target: string,
    query: Record<string, string>,
    productReference?: string,
  ): Promise<Created> => {
    const snapshot = paywall.getSnapshot();
    const freeTrial = freeTrialFor(resolved, snapshot);
    const created = await createTeleport(publicApiKey(), {
      route: target,
      ...(productReference === undefined ? {} : { productReference }),
      presentationId,
      context: attributionOf(snapshot, { freeTrial }),
      session: { query },
    });
    return { ...created, route: target, freeTrial, queryBase: query };
  };

  const saveQuery = async (record: OpenTeleport, query: Record<string, string>) => {
    await withTimeout(
      saveTeleportQuery(publicApiKey(), record.teleportId, query).then(
        (saved) => {
          if (saved) record.queryBase = query;
        },
        (error: unknown) => {
          console.warn(
            "Saving the flow on the teleport failed; the page opens with what it had:",
            error,
          );
        },
      ),
      SESSION_SAVE_TIMEOUT_MS,
      undefined,
    );
  };

  const queryPatchFor = async (
    record: OpenTeleport,
    query: Record<string, string>,
  ): Promise<string | undefined> => {
    const base = record.queryBase;
    const changed = changedQuery(base, query);
    const removed = Object.keys(base).some((key) => !Object.hasOwn(query, key));
    if (!removed && Object.keys(changed).length === 0) return undefined;
    const patch = encodeQueryPatch(changed);
    if (!removed && patch.length <= QUERY_FRAGMENT_LIMIT) {
      void saveQuery(record, query);
      return patch;
    }
    startLoading();
    await saveQuery(record, query);
    stopLoading();
    return undefined;
  };

  const preparedIsFresh = (resolved: ResolvedTeleport, target: string): boolean =>
    prepared !== undefined &&
    prepared.route === target &&
    Date.now() - prepared.createdAt < PREPARED_FRESH_MS &&
    prepared.freeTrial === freeTrialFor(resolved, paywall.getSnapshot());

  const moveIntroductoryOffer = async (
    resolved: ResolvedTeleport,
    record: OpenTeleport,
  ): Promise<boolean> => {
    const freeTrial = freeTrialFor(resolved, paywall.getSnapshot());
    if (record.freeTrial === freeTrial) return true;
    startLoading();
    const moved = await withTimeout(
      moveTeleportIntroductoryOffer(publicApiKey(), record.teleportId, freeTrial).catch(
        (error: unknown) => {
          console.warn("Moving the teleport to the current trial offer failed:", error);
          return false;
        },
      ),
      SESSION_SAVE_TIMEOUT_MS,
      false,
    );
    stopLoading();
    if (moved) record.freeTrial = freeTrial;
    return moved;
  };

  const productIdentifierOf = (productReference: string | undefined): string =>
    productReference === undefined
      ? ""
      : (paywall.getSnapshot().productsByReference[productReference]?.productId ?? "");

  const withProduct = (record: OpenTeleport, productReference: string | undefined) => {
    if (productReference === undefined || productReference === record.productReference) return;
    record.productReference = productReference;
    record.productIdentifier = productIdentifierOf(productReference);
    if (record.productIdentifier === "") return;
    post({
      event_name: "stripe_checkout_start",
      checkout_context_id: record.teleportId,
      product_identifier: record.productIdentifier,
    });
  };

  const reopen = (record: OpenTeleport, productReference?: string) => {
    withProduct(record, productReference);
    showOnceAway(record);
    open(record);
    schedulePoll(record, FAST_POLL_MS);
  };

  const launch = async (
    teleport: Created & {
      createdAt: number;
      checkoutContextId?: string;
      checkoutProductIdentifier?: string;
    },
    request: TeleportRequest,
  ): Promise<TeleportOutcome> => {
    let resolve!: (outcome: TeleportOutcome) => void;
    const outcome = new Promise<TeleportOutcome>((settle) => {
      resolve = settle;
    });
    const record: OpenTeleport = {
      teleportId: teleport.teleportId,
      url: withTappedProduct(teleport.url, request.productReference),
      route: teleport.route,
      createdAt: teleport.createdAt,
      freeTrial: teleport.freeTrial,
      queryBase: teleport.queryBase,
      checkoutContextId: teleport.checkoutContextId,
      checkoutProductIdentifier: teleport.checkoutProductIdentifier,
      productReference: request.productReference,
      productIdentifier: productIdentifierOf(request.productReference),
      postPurchase: request.postPurchase,
      stripeMetadata: request.stripeMetadata,
      outcome,
      settle: resolve,
    };
    phase = { kind: "waiting", record };
    shown = false;
    starting = undefined;
    if (record.productIdentifier !== "") {
      post({
        event_name: "stripe_checkout_start",
        checkout_context_id: record.teleportId,
        product_identifier: record.productIdentifier,
      });
    }
    const patch = await queryPatchFor(record, request.query);
    if (!isWaiting(record)) return outcome;
    if (patch !== undefined) record.queryPatch = patch;
    showOnceAway(record);
    open(record);
    schedulePoll(record, FAST_POLL_MS);
    return outcome;
  };

  const start = async (
    resolved: ResolvedTeleport,
    target: string,
    request: TeleportRequest,
  ): Promise<TeleportOutcome> => {
    try {
      return await begun(resolved, target, request);
    } finally {
      starting = undefined;
    }
  };

  const reusable = async (parked: ParkedTeleport, resolved: ResolvedTeleport) => {
    const state = await withTimeout(checkParked(parked), PARKED_TAP_CHECK_MS, "unknown" as const);
    if (state === "paid" || state === "closed" || Date.now() >= parked.reuseUntil) return state;
    const moved = await moveIntroductoryOffer(resolved, parked);
    if (parked.paid) return "paid";
    return moved && isParked(parked) ? "open" : "closed";
  };

  const begun = async (
    resolved: ResolvedTeleport,
    target: string,
    request: TeleportRequest,
  ): Promise<TeleportOutcome> => {
    if (phase.kind === "parked" && phase.record.route !== target) stopParked();
    if (phase.kind === "parked") {
      const parked = phase.record;
      const state = await reusable(parked, resolved);
      if (state === "paid") return "completed";
      stopParked();
      if (state !== "closed") return launch(parked, request);
    }
    const instant = preparedIsFresh(resolved, target);
    if (!instant) startLoading();
    let created: Created & { createdAt: number };
    try {
      const fresh = instant ? prepared : undefined;
      prepared = undefined;
      const reused = await fresh?.teleport;
      created =
        fresh !== undefined && reused !== undefined
          ? { ...reused, createdAt: fresh.createdAt }
          : {
              ...(await create(resolved, target, request.query, request.productReference)),
              createdAt: Date.now(),
            };
    } catch (error) {
      console.error("Opening the web checkout failed:", error);
      return "failed";
    } finally {
      if (!instant) stopLoading();
    }
    return launch(created, request);
  };

  const available = () => {
    const snapshot = paywall.getSnapshot();
    return (
      settings() !== undefined &&
      boot === undefined &&
      !hostedInWebSdk() &&
      platformOf(snapshot.device) === "ios" &&
      publicApiKey() !== "" &&
      asString(snapshot.device.sdkVersionPadded) >= TELEPORT_SDK_VERSION
    );
  };

  const prepare = (requested?: string, query: Record<string, string> = {}) => {
    const resolved = settings();
    const target = requested ?? resolved?.route;
    if (resolved === undefined || target === undefined || !available()) return;
    if (phase.kind === "waiting" || preparedIsFresh(resolved, target)) return;
    const freeTrial = freeTrialFor(resolved, paywall.getSnapshot());
    const entry: Prepared = {
      route: target,
      freeTrial,
      createdAt: Date.now(),
      query,
      teleport: Promise.resolve(undefined),
    };
    entry.teleport = create(resolved, target, query).then(
      (created) => {
        warmTeleportPage(created.url, stripeReferences(paywall.getSnapshot()));
        return created;
      },
      (error: unknown) => {
        console.warn("Preparing the teleport failed; a tap creates one instead:", error);
        if (prepared === entry) prepared = undefined;
        return undefined;
      },
    );
    prepared = entry;
  };

  const showSuccess = (page: TeleportBoot, paidElsewhere: boolean) => {
    const copy = teleportCopyFor(asString(paywall.getSnapshot().device.deviceLocale) || undefined);
    const link = page.appLinkUrl ?? page.returnUrl;
    const returnUrl = link === undefined ? undefined : withReason(link, "purchased");
    createTeleportScreen({
      surface: "page",
      role: "status",
      title: copy.success.title,
      body: paidElsewhere
        ? copy.success.bodyPaidElsewhere
        : returnUrl === undefined
          ? copy.success.bodyNoReturn
          : copy.success.body,
      dir: copy.dir ?? "ltr",
      status: "success",
      footer: { label: copy.success.poweredBy, href: poweredByHref() },
      actions:
        returnUrl === undefined
          ? []
          : [
              {
                label: copy.success.action,
                kind: "primary",
                href: returnUrl,
                onClick: () => fallBackToScheme(page, "purchased"),
              },
            ],
    });
  };

  const settle = (paidElsewhere: boolean) => {
    settled = true;
    const productReference = tapped;
    setPageStatus({
      status: "completed",
      paidElsewhere,
      ...(productReference === undefined ? {} : { productReference }),
    });
  };

  const returnAfterPurchase = (): boolean =>
    boot !== undefined && settings()?.completion === "direct" && openApp(boot, "purchased");

  const checkSettled = (atBoot = false): Promise<boolean> => {
    if (settled) return Promise.resolve(true);
    const key = publicApiKey();
    if (boot === undefined || key === "") return Promise.resolve(false);
    pageCheck ??= readTeleportStatus(key, boot.id)
      .then((teleport) => {
        if (settled) return true;
        if (teleport.status === "expired" && atBoot) {
          const url = new URL(window.location.href);
          url.searchParams.delete("sw_boot");
          url.searchParams.delete("sw_sig");
          url.hash = "";
          pageNavigation.replace(url.toString());
          return false;
        }
        if (teleport.status !== "completed") {
          pageCheckedAt = Date.now();
          return false;
        }
        checkoutEvents.dispatch("SHEET_CLOSE", undefined);
        stopLoading();
        settle(!atBoot);
        showSuccess(boot, !atBoot);
        return true;
      })
      .catch((error: unknown) => {
        console.warn("Checking the teleport's presentation failed:", error);
        return false;
      })
      .finally(() => {
        pageCheck = undefined;
      });
    return pageCheck;
  };

  const teleporter: Teleporter = {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    on: (event, handler) => {
      const set = handlers.get(event) ?? new Set<() => void>();
      set.add(handler);
      handlers.set(event, set);
      return () => {
        set.delete(handler);
      };
    },
    available,
    landed: (name) => {
      route = name;
    },
    begin: (request) => {
      if (starting !== undefined) return starting;
      const resolved = settings();
      const target = request.route ?? resolved?.route ?? route;
      if (resolved === undefined || target === undefined) return Promise.resolve("failed");
      if (phase.kind === "waiting" && phase.record.route !== target) {
        settleAbandoned(phase.record);
      }
      if (phase.kind === "waiting") {
        const record = phase.record;
        if (record.freeTrial === freeTrialFor(resolved, paywall.getSnapshot())) {
          reopen(record, request.productReference);
          return record.outcome;
        }
        starting = moveIntroductoryOffer(resolved, record)
          .then(async (moved) => {
            if (moved) {
              if (isWaiting(record)) reopen(record, request.productReference);
              return record.outcome;
            }
            if (!isWaiting(record)) return record.outcome;
            stop();
            record.settle("abandoned");
            return begun(resolved, target, request);
          })
          .finally(() => {
            starting = undefined;
          });
        return starting;
      }
      const started = start(resolved, target, request);
      starting = started;
      return started;
    },
    prefetch: prepare,
    beginPresentation: (id) => {
      presentationId = id ?? crypto.randomUUID();
      prepared = undefined;
    },
    endPresentation: () => {
      parkWaiting();
    },
    refreshIntroductoryOffer: () => {
      if (prepared === undefined) return;
      const target = prepared.route;
      const query = prepared.query;
      prepared = undefined;
      prepare(target, query);
    },
    inFlight: () => phase.kind === "waiting",
    handOff: (reference, purchase) => {
      const record = parkWaiting();
      const result = purchase();
      record?.settle({ reference, result });
      return result;
    },
    open: () => {
      if (phase.kind === "waiting") reopen(phase.record);
    },
    cancel: () => {
      if (phase.kind === "waiting") cancel(phase.record);
    },
    fallback: () => (phase.kind === "waiting" ? fallbackFor(phase.record) : undefined),
    showWaitingScreen: async () => {
      if (phase.kind !== "waiting" || !settings()?.overlay) return false;
      show(phase.record, true);
      await painted();
      return true;
    },
    handleReturn: async (reason) => {
      if (phase.kind === "waiting") {
        const record = phase.record;
        record.returnedAt ??= Date.now();
        if (reason !== "closed" && publicApiKey() !== "") {
          returnLoading = true;
          startLoading();
        }
        emit("return");
      }
      const hidden = hide(true);
      publish();
      if (phase.kind === "waiting") void poll(phase.record);
      if (!hidden) return false;
      await painted();
      return true;
    },
    whenUnsettled: async () => {
      if (settled) {
        returnAfterPurchase();
        return false;
      }
      const fresh = Date.now() - pageCheckedAt < PAGE_WATCH_MS + 1_000;
      if (!boot?.shared || fresh) return true;
      let loaderShown = false;
      const loader = setTimeout(() => {
        loaderShown = true;
        startLoading();
      }, PAGE_TAP_LOADER_DELAY_MS);
      const paid = await withTimeout(checkSettled(), PAGE_TAP_CHECK_MS, false);
      clearTimeout(loader);
      if (paid) return false;
      if (loaderShown) stopLoading();
      return true;
    },
    checkSettled,
    watchPresentation: () => {
      const visible = () => {
        if (document.visibilityState === "visible") void checkSettled();
      };
      document.addEventListener("visibilitychange", visible);
      if (!boot?.shared) return () => document.removeEventListener("visibilitychange", visible);
      void checkSettled();
      const interval = setInterval(() => {
        if (settled) clearInterval(interval);
        else if (document.visibilityState === "visible") void checkSettled();
      }, PAGE_WATCH_MS);
      return () => {
        document.removeEventListener("visibilitychange", visible);
        clearInterval(interval);
      };
    },
    completePurchase: async (checkoutContextId) => {
      if (boot === undefined || settings() === undefined) return;
      settled = true;
      startLoading();
      const key = publicApiKey();
      if (key !== "") {
        await withTimeout(
          completeTeleportCheckout(key, checkoutContextId).catch((error: unknown) => {
            console.warn("Completing the teleport checkout failed:", error);
          }),
          PAGE_COMPLETE_WAIT_MS,
          undefined,
        );
      }
      stopLoading();
      settle(false);
      if (!returnAfterPurchase()) showSuccess(boot, false);
    },
    followFragment: () => {
      if (boot === undefined) return;
      stopLoading();
      const next = readTeleportBoot()?.productReference;
      if (next === undefined || settled) return;
      tapped = next;
      setPageStatus({ status: "arrived", productReference: next });
    },
    returnToApp: (reason) => {
      if (boot === undefined || settings() === undefined) return;
      openApp(boot, reason);
    },
    attach: (session) => {
      purchaseInApp = session.purchase;
      const cleanups: (() => void)[] = [];
      if (boot === undefined) {
        const app = (window as typeof window & { app?: Record<string, unknown> }).app;
        if (app !== undefined) {
          app.showTeleportWaitingScreen = () => teleporter.showWaitingScreen();
          app.handleTeleportReturn = (options?: { reason?: unknown }) =>
            teleporter.handleReturn(
              typeof options?.reason === "string" ? options.reason : undefined,
            );
        }
        const opened = () => {
          teleporter.beginPresentation(session.getSnapshot().paywall?.presentation?.id);
          prepare();
        };
        if (session.getSnapshot().paywall !== undefined) opened();
        const visible = () => {
          if (document.visibilityState !== "visible") return;
          if (phase.kind === "waiting") void poll(phase.record);
          else if (phase.kind === "parked") void checkParked(phase.record);
        };
        document.addEventListener("visibilitychange", visible);
        cleanups.push(
          () => document.removeEventListener("visibilitychange", visible),
          session.on("paywall_open", opened),
          session.on("paywall_close", () => teleporter.endPresentation()),
          session.on("template_substitutions_prefix", () => teleporter.refreshIntroductoryOffer()),
        );
      } else {
        const follow = () => teleporter.followFragment();
        window.addEventListener("hashchange", follow);
        cleanups.push(teleporter.watchPresentation(), () =>
          window.removeEventListener("hashchange", follow),
        );
        if (boot.loadSession) void checkSettled(true);
      }
      return () => {
        purchaseInApp = undefined;
        for (const cleanup of cleanups) cleanup();
      };
    },
  };

  return teleporter;
};

const teleporters = new WeakMap<object, Teleporter>();

export const teleportFor = (paywall: TeleportSession): Teleporter => {
  const existing = teleporters.get(paywall);
  if (existing) return existing;
  const created = createTeleporter(paywall);
  teleporters.set(paywall, created);
  return created;
};
