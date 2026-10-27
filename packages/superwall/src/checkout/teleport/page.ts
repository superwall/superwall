import { teleportOf } from "@superwall/runtime";
import { asString } from "../api/decode";
import { checkoutEvents } from "../events";
import { startLoading, stopLoading } from "../loading";
import { completeTeleportCheckout, readTeleportQuery, readTeleportStatus } from "./api";
import { readTeleportBoot, type TeleportBoot } from "./boot";
import { teleportCopyFor } from "./copy";
import { createTeleportScreen, poweredByHref } from "./screen";
import {
  createStatusStore,
  withTimeout,
  type ReturnReason,
  type TeleportPage,
  type TeleportSession,
} from "./teleporter";

const PAGE_WATCH_MS = 5_000;
const PAGE_COMPLETE_WAIT_MS = 8_000;
const PAGE_TAP_CHECK_MS = 1_500;
const PAGE_TAP_LOADER_DELAY_MS = 200;
export const APP_OPEN_WAIT_MS = 1_000;

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

export const createTeleportPage = (paywall: TeleportSession, boot: TeleportBoot): TeleportPage => {
  const store = createStatusStore({
    status: "arrived",
    ...(boot.productReference === undefined ? {} : { productReference: boot.productReference }),
  });
  let tapped = boot.productReference;
  let settled = false;
  let pageCheck: Promise<boolean> | undefined;
  let pageCheckedAt = 0;

  const settings = () => teleportOf(paywall.getSnapshot().config?.teleport);
  const publicApiKey = () => asString(paywall.getSnapshot().device.publicApiKey);

  const showSuccess = (paidElsewhere: boolean) => {
    const copy = teleportCopyFor(asString(paywall.getSnapshot().device.deviceLocale) || undefined);
    const link = boot.appLinkUrl ?? boot.returnUrl;
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
                onClick: () => fallBackToScheme(boot, "purchased"),
              },
            ],
    });
  };

  const settle = (paidElsewhere: boolean) => {
    settled = true;
    const productReference = tapped;
    store.setStatus({
      status: "completed",
      paidElsewhere,
      ...(productReference === undefined ? {} : { productReference }),
    });
  };

  const returnAfterPurchase = (): boolean =>
    settings()?.completion === "direct" && openApp(boot, "purchased");

  const checkSettled = (atBoot = false): Promise<boolean> => {
    if (settled) return Promise.resolve(true);
    const key = publicApiKey();
    if (key === "") return Promise.resolve(false);
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
        showSuccess(!atBoot);
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

  const teleporter: TeleportPage = {
    kind: "page",
    getStatus: store.getStatus,
    subscribe: store.subscribe,
    on: store.on,
    whenUnsettled: async () => {
      if (settled) {
        returnAfterPurchase();
        return false;
      }
      const fresh = Date.now() - pageCheckedAt < PAGE_WATCH_MS + 1_000;
      if (!boot.shared || fresh) return true;
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
      if (!boot.shared) return () => document.removeEventListener("visibilitychange", visible);
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
      if (settings() === undefined) return;
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
      if (!returnAfterPurchase()) showSuccess(false);
    },
    followFragment: () => {
      stopLoading();
      const next = readTeleportBoot()?.productReference;
      if (next === undefined || settled) return;
      tapped = next;
      store.setStatus({ status: "arrived", productReference: next });
    },
    returnToApp: (reason) => {
      if (settings() === undefined) return;
      openApp(boot, reason);
    },
    attach: () => {
      const follow = () => teleporter.followFragment();
      window.addEventListener("hashchange", follow);
      const stopWatching = teleporter.watchPresentation();
      if (boot.loadSession) void checkSettled(true);
      return () => {
        stopWatching();
        window.removeEventListener("hashchange", follow);
      };
    },
  };

  return teleporter;
};
