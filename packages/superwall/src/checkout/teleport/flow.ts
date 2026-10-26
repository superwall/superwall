import {
  dismissesOnPurchase,
  teleportOf,
  type ResolvedTeleport,
  type SuperwallSession,
} from "@superwall/runtime";
import { platformOf } from "../../device";
import { attributionOf } from "../api/body";
import { asString } from "../api/decode";
import { hostedInWebSdk } from "../host/surface";
import { startLoading, stopLoading } from "../loading";
import type { PurchaseOutcome } from "../types";
import {
  completeTeleportCheckout,
  createTeleport,
  readCheckoutOf,
  readTeleportQuery,
  readTeleportStatus,
  teleportStatusUrls,
} from "./api";
import { NAV_QUERY_KEY, readTeleportBoot, type TeleportBoot } from "./boot";

export const TELEPORT_SDK_VERSION = "004.018.000";
export const TELEPORT_TTL_MS = 30 * 60 * 1000;
const CLAIMED_WAIT_MS = 2 * TELEPORT_TTL_MS;
const FAST_POLL_MS = 2_000;
const FAST_POLL_WINDOW_MS = 2 * 60 * 1000;
const SLOW_POLL_MS = 5_000;
const RETURN_GRACE_MS = 15_000;
const OVERLAY_FALLBACK_MS = 1_500;
export const APP_OPEN_WAIT_MS = 1_000;
const TAPPED_PRODUCT_QUERY_KEY = "sw_ref";

export type TeleportOutcome = PurchaseOutcome | { fallback: string };

export type TeleportState = {
  waiting: boolean;
  waitingScreen: boolean;
  completed: boolean;
  productReference?: string;
};

export type TeleportRequest = {
  productReference?: string;
  query: Record<string, string>;
};

export type Teleporter = {
  getState(): TeleportState;
  subscribe(listener: () => void): () => void;
  available(): boolean;
  begin(request: TeleportRequest): Promise<TeleportOutcome>;
  reopen(): void;
  cancel(): void;
  payInApp(): void;
  fallback(): string | undefined;
  showWaitingScreen(): boolean;
  handleReturn(): boolean;
  completePurchase(checkoutContextId: string): Promise<void>;
  returnToApp(reason?: ReturnReason): void;
};

export type ReturnReason = "purchased" | "closed";

export type TeleportSession = Pick<SuperwallSession, "getSnapshot" | "postMessage">;

type OpenTeleport = {
  teleportId: string;
  url: string;
  productReference?: string;
  productIdentifier: string;
  createdAt: number;
  checkoutContextId?: string;
  checkoutProductIdentifier?: string;
  returnedAt?: number;
  settle: (outcome: TeleportOutcome) => void;
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

let opens = 0;

export const checkoutUrlFor = (url: string, productReference: string | undefined): string => {
  const next = new URL(url);
  if (productReference !== undefined && !next.searchParams.has(TAPPED_PRODUCT_QUERY_KEY)) {
    next.searchParams.set(TAPPED_PRODUCT_QUERY_KEY, productReference);
  }
  opens += 1;
  next.hash = new URLSearchParams({
    ...(productReference === undefined ? {} : { ref: productReference }),
    o: `${Date.now().toString(36)}${opens.toString(36)}`,
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

export const openApp = (
  boot: TeleportBoot,
  appLink: ResolvedTeleport["appLink"],
  reason?: ReturnReason,
): void => {
  const link = appLink === "universal" && boot.appLinkUrl ? boot.appLinkUrl : boot.returnUrl;
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

const createTeleporter = (paywall: TeleportSession): Teleporter => {
  const listeners = new Set<() => void>();
  let state: TeleportState = {
    waiting: false,
    waitingScreen: false,
    completed: false,
    productReference: readTeleportBoot()?.productReference,
  };
  let current: OpenTeleport | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let overlayWait: (() => void) | undefined;
  let windowApis = false;

  const setState = (patch: Partial<TeleportState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const settings = () => teleportOf(paywall.getSnapshot().config?.teleport);
  const publicApiKey = () => asString(paywall.getSnapshot().device.publicApiKey);
  const post = paywall.postMessage;

  const cancelOverlayWait = () => {
    overlayWait?.();
    overlayWait = undefined;
  };

  const showOverlay = () => {
    cancelOverlayWait();
    if (current === undefined || state.waitingScreen || !settings()?.overlay) return;
    setState({ waitingScreen: true });
    post({
      event_name: "teleport_watch_start",
      teleport_id: current.teleportId,
      ...teleportStatusUrls(),
      public_api_key: publicApiKey(),
    });
  };

  const hideOverlay = () => {
    cancelOverlayWait();
    if (!state.waitingScreen) return;
    setState({ waitingScreen: false });
    post({ event_name: "teleport_watch_end" });
  };

  const showOnceAway = () => {
    const away = () => {
      if (document.visibilityState === "hidden") showOverlay();
    };
    document.addEventListener("visibilitychange", away);
    const fallback = setTimeout(showOverlay, OVERLAY_FALLBACK_MS);
    overlayWait = () => {
      document.removeEventListener("visibilitychange", away);
      clearTimeout(fallback);
    };
  };

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    current = undefined;
    hideOverlay();
    setState({ waiting: false, productReference: undefined });
  };

  const schedule = (record: OpenTeleport, delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void poll(record), delay);
  };

  const redeem = (record: OpenTeleport, checkoutContextId: string, productIdentifier?: string) => {
    stop();
    const dismiss = dismissesOnPurchase(paywall.getSnapshot().config?.postPurchase);
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

  const open = (record: OpenTeleport, waitingScreen: boolean) =>
    post({
      event_name: "open_url_external",
      url: checkoutUrlFor(record.url, record.productReference),
      teleport: true,
      ...(waitingScreen ? { waiting_screen: true } : {}),
    });

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

  const teleporter: Teleporter = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    available: () => {
      const snapshot = paywall.getSnapshot();
      return (
        snapshot.config?.teleport !== undefined &&
        readTeleportBoot() === undefined &&
        !hostedInWebSdk() &&
        platformOf(snapshot.device) === "ios" &&
        publicApiKey() !== "" &&
        asString(snapshot.device.sdkVersionPadded) >= TELEPORT_SDK_VERSION
      );
    },
    begin: async ({ productReference, query }) => {
      const resolved = settings();
      if (resolved === undefined) return "failed";
      if (current !== undefined) abandon(current);
      installWindowApis(teleporter);
      const snapshot = paywall.getSnapshot();
      const productIdentifier =
        productReference === undefined
          ? ""
          : (snapshot.productsByReference[productReference]?.productId ?? "");

      startLoading();
      let created: Awaited<ReturnType<typeof createTeleport>>;
      try {
        created = await createTeleport(publicApiKey(), {
          route: resolved.route,
          productReference,
          presentationId: crypto.randomUUID(),
          context: attributionOf(
            snapshot,
            resolved.trialEligibility === "always" ? { freeTrial: true } : {},
          ),
          session: { query },
        });
      } catch (error) {
        console.error("Opening the web checkout failed:", error);
        return "failed";
      } finally {
        stopLoading();
      }

      return new Promise<TeleportOutcome>((settle) => {
        const record: OpenTeleport = {
          ...created,
          productReference,
          productIdentifier,
          createdAt: Date.now(),
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
        open(record, resolved.overlay);
        setState({ waiting: true, productReference });
        if (resolved.overlay) showOnceAway();
        schedule(record, FAST_POLL_MS);
      });
    },
    reopen: () => {
      if (current !== undefined) open(current, false);
    },
    cancel: () => {
      if (current !== undefined) abandon(current);
    },
    payInApp: () => {
      const record = current;
      const reference = fallback();
      if (record === undefined || reference === undefined) return;
      stop();
      record.settle({ fallback: reference });
    },
    fallback,
    showWaitingScreen: () => {
      showOverlay();
      return state.waitingScreen;
    },
    handleReturn: () => {
      const record = current;
      if (record === undefined) return false;
      record.returnedAt ??= Date.now();
      const shown = state.waitingScreen;
      hideOverlay();
      void poll(record);
      return shown;
    },
    completePurchase: async (checkoutContextId) => {
      const boot = readTeleportBoot();
      const resolved = settings();
      if (boot === undefined || resolved === undefined) return;
      await completeTeleportCheckout(publicApiKey(), checkoutContextId);
      if (resolved.returnStyle === "screen") setState({ completed: true });
      else openApp(boot, resolved.returnStyle === "alert" ? "scheme" : "universal", "purchased");
    },
    returnToApp: (reason) => {
      const boot = readTeleportBoot();
      const resolved = settings();
      if (boot === undefined || resolved === undefined) return;
      openApp(boot, resolved.appLink, reason);
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
