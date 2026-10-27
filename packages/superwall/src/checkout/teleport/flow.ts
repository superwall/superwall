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
import { hostedInWebSdk } from "../host/surface";
import { startLoading, stopLoading } from "../loading";
import { isStripeProductIdentifier } from "../products";
import type { PurchaseOutcome } from "../types";
import {
  completeTeleportCheckout,
  createTeleport,
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
  NAV_QUERY_KEY,
  QUERY_FRAGMENT_KEY,
  readTeleportBoot,
  TAPPED_PRODUCT_FRAGMENT_KEY,
  type TeleportBoot,
} from "./boot";

export const TELEPORT_SDK_VERSION = "004.018.000";
export const TELEPORT_TTL_MS = 30 * 60 * 1000;
const CLAIMED_WAIT_MS = 2 * TELEPORT_TTL_MS;
const PREPARED_FRESH_MS = 10 * 60 * 1000;
const FAST_POLL_MS = 2_000;
const FAST_POLL_WINDOW_MS = 2 * 60 * 1000;
const SLOW_POLL_MS = 5_000;
const RETURN_GRACE_MS = 15_000;
const WAITING_FALLBACK_MS = 1_500;
const QUERY_FRAGMENT_LIMIT = 2_048;
export const APP_OPEN_WAIT_MS = 1_000;
const TAPPED_PRODUCT_QUERY_KEY = "sw_ref";

export type TeleportStatus =
  | { status: "idle" }
  | { status: "waiting"; productReference?: string }
  | { status: "arrived"; productReference?: string }
  | { status: "completed"; productReference?: string };

export type HandedOff = { reference: string; result: Promise<{ status: PurchaseOutcome }> };

export type TeleportOutcome = PurchaseOutcome | HandedOff;

export type TeleportRequest = {
  route?: string;
  productReference?: string;
  query: Record<string, string>;
  postPurchase?: SuperwallPostPurchase;
  stripeMetadata?: Readonly<Record<string, string>>;
};

export type Teleporter = {
  getStatus(): TeleportStatus;
  subscribe(listener: () => void): () => void;
  available(): boolean;
  landed(route: string): void;
  begin(request: TeleportRequest): Promise<TeleportOutcome>;
  prefetch(route?: string, query?: Record<string, string>): void;
  inFlight(): boolean;
  handOff(reference: string, result: Promise<{ status: PurchaseOutcome }>): void;
  reopen(): void;
  cancel(): void;
  fallback(): string | undefined;
  showWaitingScreen(): boolean;
  handleReturn(): boolean;
  completePurchase(checkoutContextId: string): Promise<void>;
  returnToApp(reason?: ReturnReason): void;
};

export type ReturnReason = "purchased" | "closed";

export type TeleportSession = Pick<SuperwallSession, "getSnapshot" | "postMessage">;

type OpenTeleport = CreatedTeleport & {
  productReference?: string;
  productIdentifier: string;
  query: Record<string, string>;
  createdAt: number;
  checkoutContextId?: string;
  checkoutProductIdentifier?: string;
  returnedAt?: number;
  queryPatch?: string;
  postPurchase?: SuperwallPostPurchase;
  stripeMetadata?: Readonly<Record<string, string>>;
  settle: (outcome: TeleportOutcome) => void;
};

type Prepared = {
  route: string;
  freeTrial: boolean;
  query: Record<string, string>;
  at: number;
  teleport: Promise<CreatedTeleport | undefined>;
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
): string => {
  const next = new URL(url);
  if (productReference !== undefined && !next.searchParams.has(TAPPED_PRODUCT_QUERY_KEY)) {
    next.searchParams.set(TAPPED_PRODUCT_QUERY_KEY, productReference);
  }
  opens += 1;
  next.hash = new URLSearchParams({
    ...(productReference === undefined ? {} : { [TAPPED_PRODUCT_FRAGMENT_KEY]: productReference }),
    o: `${Date.now().toString(36)}${opens.toString(36)}`,
    ...(queryPatch === undefined ? {} : { [QUERY_FRAGMENT_KEY]: queryPatch }),
  }).toString();
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
};

export const openApp = (boot: TeleportBoot, reason?: ReturnReason): void => {
  const link = boot.appLinkUrl ?? boot.returnUrl;
  if (link === undefined) return;
  pageNavigation.assign(withReason(link, reason));
  const scheme = boot.returnUrl;
  if (scheme === undefined || link === scheme) return;
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
  const boot = readTeleportBoot();
  let status: TeleportStatus =
    boot === undefined
      ? { status: "idle" }
      : {
          status: "arrived",
          ...(boot.productReference === undefined
            ? {}
            : { productReference: boot.productReference }),
        };
  let current: OpenTeleport | undefined;
  let prepared: Prepared | undefined;
  let route: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitAway: (() => void) | undefined;
  let windowApis = false;
  let creating: Promise<TeleportOutcome> | undefined;

  const setStatus = (next: TeleportStatus) => {
    status = next;
    for (const listener of listeners) listener();
  };

  const settings = () => teleportOf(paywall.getSnapshot().config?.teleport);
  const publicApiKey = () => asString(paywall.getSnapshot().device.publicApiKey);
  const post = paywall.postMessage;

  const stopWaitingAway = () => {
    waitAway?.();
    waitAway = undefined;
  };

  const startWaiting = () => {
    stopWaitingAway();
    if (current === undefined || status.status === "waiting") return;
    setStatus({
      status: "waiting",
      ...(current.productReference === undefined
        ? {}
        : { productReference: current.productReference }),
    });
    post({
      event_name: "teleport_watch_start",
      teleport_id: current.teleportId,
      ...teleportStatusUrls(),
      public_api_key: publicApiKey(),
    });
  };

  const stopWaiting = () => {
    stopWaitingAway();
    if (status.status !== "waiting") return;
    setStatus({ status: "idle" });
    post({ event_name: "teleport_watch_end" });
  };

  const waitOnceAway = () => {
    stopWaitingAway();
    const away = () => {
      if (document.visibilityState === "hidden") startWaiting();
    };
    document.addEventListener("visibilitychange", away);
    const fallback = setTimeout(startWaiting, WAITING_FALLBACK_MS);
    waitAway = () => {
      document.removeEventListener("visibilitychange", away);
      clearTimeout(fallback);
    };
  };

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    current = undefined;
    stopWaiting();
  };

  const schedule = (record: OpenTeleport, delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void poll(record), delay);
  };

  const redeem = (record: OpenTeleport, checkoutContextId: string, productIdentifier?: string) => {
    stop();
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
        productIdentifier ?? record.checkoutProductIdentifier ?? record.productIdentifier,
      ...(dismiss === undefined ? {} : { should_dismiss: dismiss }),
    });
    record.settle("completed");
  };

  const abandon = (record: OpenTeleport) => {
    stop();
    post({
      event_name: "stripe_checkout_abandon",
      checkout_context_id: record.checkoutContextId ?? record.teleportId,
      product_identifier: record.productIdentifier,
    });
    record.settle("abandoned");
  };

  const poll = async (record: OpenTeleport) => {
    let checked = false;
    try {
      const teleport = await readTeleportStatus(publicApiKey(), record.teleportId);
      if (current !== record) return;
      if (teleport.checkoutContextId && teleport.checkoutContextId !== record.checkoutContextId) {
        record.checkoutContextId = teleport.checkoutContextId;
        record.checkoutProductIdentifier = teleport.checkoutProductIdentifier;
      }
      if (teleport.status === "completed" && teleport.checkoutContextId) {
        redeem(record, teleport.checkoutContextId, teleport.checkoutProductIdentifier);
        return;
      }
      if (record.checkoutContextId) {
        const checkout = await readCheckoutOf(publicApiKey(), record.checkoutContextId);
        if (current !== record) return;
        if (checkout === "completed") {
          redeem(record, record.checkoutContextId);
          return;
        }
      }
      if (teleport.status === "expired") {
        abandon(record);
        return;
      }
      checked = true;
    } catch (error) {
      console.warn("Checking the web checkout failed; retrying:", error);
    }
    if (current !== record) return;
    const age = Date.now() - record.createdAt;
    if (age >= (record.checkoutContextId ? CLAIMED_WAIT_MS : TELEPORT_TTL_MS)) {
      abandon(record);
      return;
    }
    if (record.returnedAt !== undefined) {
      if (checked && Date.now() - record.returnedAt >= RETURN_GRACE_MS) abandon(record);
      else schedule(record, FAST_POLL_MS);
      return;
    }
    schedule(record, age < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS);
  };

  const open = (record: OpenTeleport) => {
    const overlay = settings()?.overlay === true;
    post({
      event_name: "open_url_external",
      url: checkoutUrlFor(record.url, record.productReference, record.queryPatch),
      teleport: true,
      ...(overlay ? { waiting_screen: true } : {}),
    });
    waitOnceAway();
  };

  const fallback = (): string | undefined => {
    const reference = current?.productReference;
    if (reference === undefined) return undefined;
    const candidate = settings()?.fallbacks[reference];
    if (candidate === undefined) return undefined;
    const product = paywall.getSnapshot().productsByReference[candidate];
    return product?.productId && product.variables.price ? candidate : undefined;
  };

  const installWindowApis = (teleporter: Teleporter) => {
    if (windowApis) return;
    windowApis = true;
    const host = window as typeof window & {
      showTeleportWaitingScreen?: () => Promise<boolean>;
      handleTeleportReturn?: () => Promise<boolean>;
    };
    host.showTeleportWaitingScreen = async () => teleporter.showWaitingScreen();
    host.handleTeleportReturn = async () => teleporter.handleReturn();
  };

  const create = (
    resolved: ResolvedTeleport,
    target: string,
    query: Record<string, string>,
    productReference?: string,
  ) => {
    const snapshot = paywall.getSnapshot();
    return createTeleport(publicApiKey(), {
      route: target,
      ...(productReference === undefined ? {} : { productReference }),
      presentationId: crypto.randomUUID(),
      context: attributionOf(snapshot, { freeTrial: freeTrialFor(resolved, snapshot) }),
      session: { query },
    });
  };

  const takePrepared = (resolved: ResolvedTeleport, target: string): Prepared | undefined => {
    const candidate = prepared;
    prepared = undefined;
    if (candidate === undefined || candidate.route !== target) return undefined;
    if (Date.now() - candidate.at >= PREPARED_FRESH_MS) return undefined;
    if (candidate.freeTrial !== freeTrialFor(resolved, paywall.getSnapshot())) return undefined;
    return candidate;
  };

  const queryPatchFor = async (
    teleport: CreatedTeleport,
    saved: Record<string, string>,
    query: Record<string, string>,
  ): Promise<string | undefined> => {
    const changed = changedQuery(saved, query);
    const removed = Object.keys(saved).some((key) => !Object.hasOwn(query, key));
    if (!removed && Object.keys(changed).length === 0) return undefined;
    const patch = encodeQueryPatch(changed);
    if (!removed && patch.length <= QUERY_FRAGMENT_LIMIT) return patch;
    try {
      await saveTeleportQuery(publicApiKey(), teleport.teleportId, query);
    } catch (error) {
      console.warn(
        "Saving the flow on the teleport failed; the page opens with what it had:",
        error,
      );
    }
    return undefined;
  };

  const start = async (
    resolved: ResolvedTeleport,
    target: string,
    { productReference, query, postPurchase, stripeMetadata }: TeleportRequest,
  ): Promise<TeleportOutcome> => {
    if (current !== undefined) abandon(current);
    installWindowApis(teleporter);
    const snapshot = paywall.getSnapshot();
    const productIdentifier =
      productReference === undefined
        ? ""
        : (snapshot.productsByReference[productReference]?.productId ?? "");

    startLoading();
    let created: CreatedTeleport | undefined;
    let queryPatch: string | undefined;
    try {
      const reused = takePrepared(resolved, target);
      created = await reused?.teleport;
      if (created !== undefined && reused !== undefined) {
        queryPatch = await queryPatchFor(created, reused.query, query);
      } else {
        created = await create(resolved, target, query, productReference);
      }
    } catch (error) {
      console.error("Opening the web checkout failed:", error);
      return "failed";
    } finally {
      stopLoading();
      creating = undefined;
    }
    const teleport = created;

    return new Promise<TeleportOutcome>((settle) => {
      const record: OpenTeleport = {
        ...teleport,
        productReference,
        productIdentifier,
        query,
        createdAt: Date.now(),
        ...(queryPatch === undefined ? {} : { queryPatch }),
        postPurchase,
        stripeMetadata,
        settle,
      };
      current = record;
      if (productIdentifier !== "") {
        post({
          event_name: "stripe_checkout_start",
          checkout_context_id: record.teleportId,
          product_identifier: productIdentifier,
        });
      }
      open(record);
      schedule(record, FAST_POLL_MS);
    });
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

  const teleporter: Teleporter = {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    available,
    landed: (name) => {
      route = name;
    },
    begin: (request) => {
      if (creating !== undefined) return creating;
      const resolved = settings();
      const target = request.route ?? resolved?.route ?? route;
      if (resolved === undefined || target === undefined) return Promise.resolve("failed");
      const started = start(resolved, target, request);
      creating = started;
      return started;
    },
    prefetch: (requested, query = {}) => {
      const resolved = settings();
      const target = requested ?? resolved?.route;
      if (resolved === undefined || target === undefined || !available()) return;
      const snapshot = paywall.getSnapshot();
      const freeTrial = freeTrialFor(resolved, snapshot);
      if (
        prepared !== undefined &&
        prepared.route === target &&
        prepared.freeTrial === freeTrial &&
        Date.now() - prepared.at < PREPARED_FRESH_MS
      ) {
        return;
      }
      const teleport = create(resolved, target, query).then(
        (created) => {
          warmTeleportPage(created.url, stripeReferences(paywall.getSnapshot()));
          return created;
        },
        (error: unknown) => {
          console.warn("Preparing the teleport failed; a tap creates one instead:", error);
          return undefined;
        },
      );
      prepared = { route: target, freeTrial, query, at: Date.now(), teleport };
    },
    inFlight: () => current !== undefined,
    handOff: (reference, result) => {
      const record = current;
      if (record === undefined) return;
      stop();
      record.settle({ reference, result });
    },
    reopen: () => {
      if (current === undefined) return;
      current.returnedAt = undefined;
      open(current);
    },
    cancel: () => {
      if (current !== undefined) abandon(current);
    },
    fallback,
    showWaitingScreen: () => {
      startWaiting();
      return status.status === "waiting" && settings()?.overlay === true;
    },
    handleReturn: () => {
      const record = current;
      if (record === undefined) return false;
      record.returnedAt ??= Date.now();
      const shown = status.status === "waiting" && settings()?.overlay === true;
      stopWaiting();
      void poll(record);
      return shown;
    },
    completePurchase: async (checkoutContextId) => {
      const resolved = settings();
      if (boot === undefined || resolved === undefined) return;
      await completeTeleportCheckout(publicApiKey(), checkoutContextId);
      setStatus({
        status: "completed",
        ...(status.status !== "idle" && status.productReference !== undefined
          ? { productReference: status.productReference }
          : {}),
      });
      if (resolved.completion === "direct") openApp(boot, "purchased");
    },
    returnToApp: (reason) => {
      if (boot === undefined || settings() === undefined) return;
      openApp(boot, reason);
    },
  };

  if (boot !== undefined) {
    window.addEventListener("hashchange", () => {
      const tapped = readTeleportBoot()?.productReference;
      if (status.status !== "arrived" || tapped === undefined) return;
      if (tapped === status.productReference) return;
      setStatus({ status: "arrived", productReference: tapped });
    });
  }

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
