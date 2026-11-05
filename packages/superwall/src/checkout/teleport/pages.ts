import type { ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { resolveLocale, type SuperwallLocalizationConfig } from "@superwall/runtime";
import { PRERENDER_ATTRIBUTE } from "../../document";
import { readTeleportBoot, type TeleportBoot } from "./boot";

export const NO_PRODUCT = "__none__";

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

export const expectedTeleportPageKey = (
  boot: TeleportBoot | undefined,
  localization: SuperwallLocalizationConfig | undefined,
): string | undefined => {
  if (boot === undefined || boot.hasIntroductoryOffer === undefined) return undefined;
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
  localization: SuperwallLocalizationConfig | undefined,
): MountedApp => {
  const page = element.getAttribute(PRERENDER_ATTRIBUTE);
  element.removeAttribute(PRERENDER_ATTRIBUTE);
  const expected = expectedTeleportPageKey(readTeleportBoot(), localization);
  if (page !== null && page === expected && element.firstChild !== null) {
    return { root: hydrateRoot(element, app), hydrated: true };
  }
  element.replaceChildren();
  const root = createRoot(element);
  root.render(app);
  return { root, hydrated: false };
};
