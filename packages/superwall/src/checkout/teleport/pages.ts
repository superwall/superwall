import type { ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import {
  resolveLocale,
  teleportOf,
  type SuperwallLocalizationConfig,
  type SuperwallTeleportConfig,
} from "@superwall/runtime";
import { PRERENDER_ATTRIBUTE } from "../../document";
import { NAV_QUERY_KEY, readTeleportBoot, type TeleportBoot } from "./boot";

export const NO_PRODUCT = "__none__";

const PAGE_REFERENCE = /^[\w.-]{1,191}$/;

export const isTeleportPageReference = (reference: string): boolean =>
  PAGE_REFERENCE.test(reference) && reference !== NO_PRODUCT && !/^\.+$/.test(reference);

export const teleportPageKey = (
  locale: string,
  productReference: string | undefined,
  hasIntroductoryOffer: boolean,
): string => `${locale}/${productReference ?? NO_PRODUCT}/${hasIntroductoryOffer ? 1 : 0}`;

const requestedLocale = (boot: TeleportBoot): string | undefined => {
  const device = boot.variables?.device;
  if (typeof device !== "object" || device === null) return undefined;
  const { deviceLocale, deviceLanguageCode } = device as Record<string, unknown>;
  const requested = deviceLocale ?? deviceLanguageCode;
  return typeof requested === "string" ? requested : undefined;
};

const openingRoute = (boot: TeleportBoot): string => {
  const asked = new URLSearchParams(window.location.search).get(NAV_QUERY_KEY);
  return asked === null || asked === "" ? boot.route : asked;
};

export type TeleportPageConfig = {
  localization?: SuperwallLocalizationConfig;
  teleport?: SuperwallTeleportConfig;
};

export const expectedTeleportPageKey = (
  boot: TeleportBoot | undefined,
  config: TeleportPageConfig,
): string | undefined => {
  if (boot === undefined || boot.hasIntroductoryOffer === undefined) return undefined;
  const prerendered = teleportOf(config.teleport)?.route;
  if (prerendered === undefined || openingRoute(boot) !== prerendered) return undefined;
  if (boot.productReference !== undefined && !isTeleportPageReference(boot.productReference)) {
    return undefined;
  }
  const { localization } = config;
  return teleportPageKey(
    resolveLocale(requestedLocale(boot), localization),
    boot.productReference,
    boot.hasIntroductoryOffer,
  );
};

export type MountedApp = { root: Root; hydrated: boolean };

export const mountApp = (
  element: HTMLElement,
  app: ReactNode,
  config: TeleportPageConfig,
): MountedApp => {
  const page = element.getAttribute(PRERENDER_ATTRIBUTE);
  element.removeAttribute(PRERENDER_ATTRIBUTE);
  const expected = expectedTeleportPageKey(readTeleportBoot(), config);
  if (page !== null && page === expected && element.firstChild !== null) {
    return { root: hydrateRoot(element, app), hydrated: true };
  }
  element.replaceChildren();
  const root = createRoot(element);
  root.render(app);
  return { root, hydrated: false };
};
