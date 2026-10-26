import { checkoutModeOf, type SuperwallRuntimeSnapshot } from "@superwall/runtime";
import { platformOf } from "../../device";
import { asString } from "../api/decode";
import { readTeleportBoot } from "../teleport/boot";
import type { CheckoutMode } from "../types";
import { hostedInWebSdk } from "./surface";

/**
 * Native SDK versions old enough to change what web checkout may do, as
 * paywall.js gates them (`pjs/utils/sdkVersion.ts`). The SDK reports
 * `sdkVersionPadded` in its device variables (`004.010.008`), which sorts
 * lexicographically.
 */
const IN_PAYWALL_CHECKOUT = "004.010.008";
const CHECKOUT_EVENTS = "004.014.000";

const paddedVersionOf = (snapshot: SuperwallRuntimeSnapshot): string =>
  asString(snapshot.device.sdkVersionPadded);

/**
 * Whether the SDK can host payment inside the paywall. Below this it knows
 * nothing of the checkout lifecycle, so a shopper is sent to Superwall's
 * hosted page instead — the same downgrade paywall.js makes. A host that
 * reports no version is assumed current, as paywall.js assumes. The gates are
 * native SDK versions: the Web SDK numbers its own releases (0.x) and always
 * hosts the sheet.
 */
export const sdkHostsCheckoutInPaywall = (snapshot: SuperwallRuntimeSnapshot): boolean => {
  if (hostedInWebSdk()) return true;
  const padded = paddedVersionOf(snapshot);
  return padded === "" || padded >= IN_PAYWALL_CHECKOUT;
};

/**
 * Whether the SDK redeems a completed web purchase itself. Below this — and
 * for a host that reports no version, which paywall.js also treats as old
 * here — the paywall asks the backend for a redemption link and hands it back
 * through `open_deep_link`, or the shopper pays and is granted nothing. The
 * Web SDK needs no link: `complete-webapp` binds the entitlement and the SDK
 * reads it back on `post_checkout_complete`.
 */
export const sdkRedeemsCheckout = (snapshot: SuperwallRuntimeSnapshot): boolean =>
  hostedInWebSdk() || paddedVersionOf(snapshot) >= CHECKOUT_EVENTS;

export const checkoutModeFor = (
  snapshot: SuperwallRuntimeSnapshot,
  requested?: CheckoutMode,
): CheckoutMode => {
  if (readTeleportBoot() !== undefined) {
    return requested === "sheet" || requested === "applePay" ? requested : "applePay";
  }
  if (!sdkHostsCheckoutInPaywall(snapshot)) return "external";
  if (!hostedInWebSdk() && platformOf(snapshot.device) === "ios") return "external";
  const configured = checkoutModeOf(snapshot.config?.checkout);
  if (configured !== "sheet" && configured !== "applePay") return "external";
  return requested ?? configured;
};
