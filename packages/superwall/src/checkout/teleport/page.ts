import { teleportOf } from "@superwall/runtime";
import { asString } from "../api/decode";
import { checkoutEvents } from "../events";
import { startLoading, stopLoading } from "../loading";
import { completeTeleportCheckout, readTeleportQuery, readTeleportStatus } from "./api";
import { readTeleportBoot, type TeleportBoot } from "./boot";
import { teleportCopyFor } from "./copy";
import { createReturnDim, createTeleportScreen, poweredByHref, promptsLikeSafari } from "./screen";
import {
  createStatusStore,
  withTimeout,
  type ReturnReason,
  type ReturnResult,
  type TeleportPage,
  type TeleportSession,
} from "./teleporter";

const PAGE_WATCH_MS = 5_000;
const PAGE_COMPLETE_WAIT_MS = 8_000;
const PAGE_TAP_CHECK_MS = 1_500;
const PAGE_TAP_LOADER_DELAY_MS = 200;
export const APP_OPEN_WAIT_MS = 1_000;
export const PROMPT_WAIT_MS = 500;
export const ANSWER_WAIT_MS = 3_000;
export const FOCUS_WAIT_MS = 3_000;

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

export type ReturnHint = { caption: string; dir: "ltr" | "rtl"; answered?: () => void };

const watchPrompt = (assign: () => void, hint?: ReturnHint): Promise<ReturnResult> =>
  new Promise((resolve) => {
    let dim: ReturnType<typeof createReturnDim> | undefined;
    let prompted = false;
    let answered = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: ReturnResult) => {
      clearTimeout(timer);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      window.removeEventListener("focus", ask);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", leave);
      dim?.remove();
      resolve(result);
    };
    const blur = (event: Event) => {
      if (event.target instanceof Node || prompted) return;
      prompted = true;
      clearTimeout(timer);
      if (!promptsLikeSafari(navigator.userAgent)) return;
      dim = createReturnDim();
      if (hint !== undefined) dim.showHint(hint.caption, hint.dir);
    };
    const focus = (event: Event) => {
      if (event.target instanceof Node || !prompted || answered) return;
      answered = true;
      dim?.remove();
      hint?.answered?.();
      timer = setTimeout(() => finish("cancelled"), ANSWER_WAIT_MS);
    };
    const asking = () => prompted && !answered;
    const hide = () => {
      if (!asking()) finish("opened");
    };
    const leave = () => {
      if (document.visibilityState === "hidden" && !asking()) finish("opened");
    };
    const ask = () => {
      window.removeEventListener("focus", ask);
      clearTimeout(timer);
      window.addEventListener("blur", blur);
      window.addEventListener("focus", focus);
      timer = setTimeout(() => finish("no_app"), PROMPT_WAIT_MS);
      assign();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", leave);
    if (document.hasFocus()) ask();
    else {
      window.addEventListener("focus", ask);
      timer = setTimeout(ask, FOCUS_WAIT_MS);
    }
  });

const assignScheme = (scheme: string, hint?: ReturnHint): Promise<ReturnResult> =>
  watchPrompt(() => pageNavigation.assign(scheme), hint);

const universalLink = (boot: TeleportBoot): string | undefined =>
  boot.appLinkUrl === boot.returnUrl ? undefined : boot.appLinkUrl;

const fallBackToScheme = (
  boot: TeleportBoot,
  reason?: ReturnReason,
  hint?: ReturnHint,
): Promise<ReturnResult> =>
  new Promise((resolve) => {
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
      if (opened || document.visibilityState !== "visible") {
        resolve("opened");
      } else if (boot.returnUrl === undefined) {
        resolve("no_app");
      } else resolve(assignScheme(withReason(boot.returnUrl, reason), hint));
    }, APP_OPEN_WAIT_MS);
  });

const followTappedLink = (
  boot: TeleportBoot,
  reason: ReturnReason,
  hint: ReturnHint,
): Promise<ReturnResult> =>
  universalLink(boot) === undefined
    ? watchPrompt(() => {}, hint)
    : fallBackToScheme(boot, reason, hint);

export const openApp = (
  boot: TeleportBoot,
  reason?: ReturnReason,
  hint?: ReturnHint,
): Promise<ReturnResult> | undefined => {
  const link = universalLink(boot);
  if (link !== undefined) {
    pageNavigation.assign(withReason(link, reason));
    return fallBackToScheme(boot, reason, hint);
  }
  if (boot.returnUrl === undefined) return undefined;
  return assignScheme(withReason(boot.returnUrl, reason), hint);
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
  let returns = 0;
  let successShown = false;

  const settings = () => teleportOf(paywall.getSnapshot().config?.teleport);
  const publicApiKey = () => asString(paywall.getSnapshot().device.publicApiKey);

  const copyFor = () =>
    teleportCopyFor(asString(paywall.getSnapshot().device.deviceLocale) || undefined);
  const hintFor = (reason: ReturnReason = "closed"): ReturnHint => {
    const copy = copyFor();
    return { caption: copy.returning[reason], dir: copy.dir ?? "ltr" };
  };

  const track = (attempt: Promise<ReturnResult> | undefined): Promise<ReturnResult> => {
    if (attempt === undefined) return Promise.resolve("no_app");
    returns += 1;
    if (returns === 1) store.notify();
    return attempt.then((result) => {
      returns -= 1;
      if (returns === 0) store.notify();
      return result;
    });
  };

  const showSuccess = (paidElsewhere: boolean) => {
    if (successShown) return;
    successShown = true;
    const copy = copyFor();
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
                onClick: () =>
                  void track(followTappedLink(boot, "purchased", hintFor("purchased"))),
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

  const returnAfterPurchase = (): boolean => {
    if (settings()?.completion !== "direct") return false;
    const attempt = openApp(boot, "purchased", {
      ...hintFor("purchased"),
      answered: () => showSuccess(false),
    });
    if (attempt === undefined) return false;
    void track(attempt).then((result) => {
      if (result !== "opened") showSuccess(false);
    });
    return true;
  };

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
    returnToApp: async (reason) => {
      if (settings() === undefined) return "no_app";
      return track(openApp(boot, reason, hintFor(reason)));
    },
    returning: () => returns > 0,
    attach: () => {
      const follow = () => teleporter.followFragment();
      window.addEventListener("hashchange", follow);
      if (boot.loadSession) void checkSettled(true);
      const stopWatching = teleporter.watchPresentation();
      return () => {
        stopWatching();
        window.removeEventListener("hashchange", follow);
      };
    },
  };

  return teleporter;
};
