import { teleportOf } from "@superwall/runtime";
import { platformOf } from "../../device";
import type { PurchaseOutcome } from "../types";
import { NAV_QUERY_KEY, TAPPED_PRODUCT_QUERY_KEY } from "./boot";
import {
  createStatusStore,
  type AppTeleport,
  type TeleportOutcome,
  type TeleportSession,
} from "./teleporter";

export type InlineRouter = {
  push: (route: string) => void;
  back: (count: number) => void;
};

const inlineRouters = new WeakMap<object, InlineRouter>();

export const provideInlineRouter = (paywall: object, router: InlineRouter): (() => void) => {
  inlineRouters.set(paywall, router);
  return () => {
    if (inlineRouters.get(paywall) === router) inlineRouters.delete(paywall);
  };
};

type WebHalf = {
  depth: number;
  productReference?: string;
  settle: (outcome: TeleportOutcome) => void;
};

export const studioTeleportUrl = (route: string, productReference?: string): string => {
  const url = new URL(window.location.href);
  url.searchParams.set(NAV_QUERY_KEY, route);
  if (productReference !== undefined)
    url.searchParams.set(TAPPED_PRODUCT_QUERY_KEY, productReference);
  return url.toString();
};

export const createStudioTeleporter = (paywall: TeleportSession): AppTeleport => {
  const store = createStatusStore({ status: "idle" });
  const settings = () => teleportOf(paywall.getSnapshot().config?.teleport);
  let route: string | undefined;
  let depth = 0;
  let web: WebHalf | undefined;

  const backInApp = () => {
    const left = web;
    if (left === undefined) return;
    web = undefined;
    store.setStatus({ status: "idle" });
    store.emit("return");
    left.settle("abandoned");
  };

  const available = () =>
    web === undefined &&
    settings() !== undefined &&
    platformOf(paywall.getSnapshot().device) === "ios" &&
    inlineRouters.has(paywall);

  return {
    kind: "app",
    getStatus: store.getStatus,
    subscribe: store.subscribe,
    on: store.on,
    available,
    landed: (name, at = depth) => {
      route = name;
      depth = at;
      if (web !== undefined && at < web.depth) backInApp();
    },
    begin: (request) => {
      const router = inlineRouters.get(paywall);
      const target = request.route ?? settings()?.route ?? route;
      if (!available() || router === undefined || target === undefined) {
        return Promise.resolve("failed");
      }
      const outcome = new Promise<TeleportOutcome>((resolve) => {
        web = {
          depth: depth + 1,
          settle: resolve,
          ...(request.productReference === undefined
            ? {}
            : { productReference: request.productReference }),
        };
      });
      try {
        router.push(target);
      } catch (error) {
        web = undefined;
        throw error;
      }
      paywall.postMessage({
        event_name: "open_url_external",
        url: studioTeleportUrl(target, request.productReference),
        teleport: true,
      });
      store.setStatus(
        request.productReference === undefined
          ? { status: "arrived" }
          : { status: "arrived", productReference: request.productReference },
      );
      store.emit("open");
      return outcome;
    },
    prefetch: () => {},
    beginPresentation: () => {},
    endPresentation: backInApp,
    refreshIntroductoryOffer: () => {},
    inFlight: () => web !== undefined,
    handOff: <T extends { status: PurchaseOutcome }>(
      reference: string,
      purchase: () => Promise<T>,
    ): Promise<T> => {
      const half = web;
      const result = purchase();
      half?.settle({ reference, result });
      void result.then(
        (bought) => {
          if (bought.status !== "completed" || web !== half || half === undefined) return;
          store.setStatus({
            status: "completed",
            paidElsewhere: false,
            ...(half.productReference === undefined
              ? {}
              : { productReference: half.productReference }),
          });
          store.emit("complete");
        },
        () => {},
      );
      return result;
    },
    returnToApp: () => {
      const half = web;
      const router = inlineRouters.get(paywall);
      if (half === undefined || router === undefined) return;
      router.back(depth - half.depth + 1);
    },
    open: () => {},
    cancel: () => {},
    fallback: () => undefined,
    showWaitingScreen: async () => false,
    handleReturn: async () => false,
    attach: () => () => {},
  };
};
