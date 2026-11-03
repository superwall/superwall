import * as React from "react";
import type { SuperwallDeviceVariables } from "@superwall/runtime";
import { cutoutOf, modelOf, platformOf, type DeviceCutout, type DevicePlatform } from "../device";
import { inAppBrowser, type SuperwallInAppBrowser } from "../browser";
import { hostOf, type SuperwallHost } from "../host";
import { useMediaQuery } from "./useMediaQuery";
import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type UseDeviceResult = SuperwallDeviceVariables & {
  /** Live viewport orientation, derived in the page rather than reported by the host. */
  orientation: "portrait" | "landscape";
  /**
   * The host SDK's platform, normalized: `"ios"` (also an iPad app on a Mac),
   * `"android"`, `"web"` for the Web SDK, or `undefined` for a host that has
   * not said (the studio, a plain page). Known from the first render. Branch on
   * this, not on the raw `platform` string, whose casing is the host's.
   */
  hostPlatform: DevicePlatform | undefined;
  /**
   * What is showing this paywall: `"ios-sdk"` and `"android-sdk"` for an app
   * (the native SDKs, and Flutter or React Native on top of them), `"web-sdk"`
   * for the Web SDK on a merchant's page, `"web-paywall"` for Superwall's
   * hosted web paywall page, `"web-teleport"` for the page an app teleported to,
   * `"studio"` for a preview, and `"browser"` for anything else. Known from
   * the first render. Where `hostPlatform` says which platform the user is
   * on, this says which surface, so a paywall can tell the Web SDK from the
   * hosted page.
   */
  host: SuperwallHost;
  /**
   * The app whose in-app browser shows this page, read from the user agent:
   * `"instagram"`, `"facebook"`, `"tiktok"`, `"snapchat"`, `"pinterest"`,
   * `"linkedin"`, `"twitter"`, `"wechat"` or `"line"`. `undefined` in a
   * regular browser, inside an app's own paywall (the native SDKs), or for an
   * app it does not recognize. Known from the first render.
   */
  inAppBrowser: SuperwallInAppBrowser | undefined;
  /**
   * What the screen's top edge holds on an iPhone: `"island"`, `"notch"`,
   * `"none"`, or `"strip"` for iPhone Duo, whose camera strip sits on the right
   * when closed or landscape and on top when open in portrait. `undefined` off
   * iPhone. Lay out with the `--sw-safe-area-inset-*` variables rather than
   * this; use it only for a design choice the insets cannot make.
   */
  cutout: DeviceCutout | undefined;
};

/** The host's device variables (platform, locale, osVersion, …) plus live `orientation`, `hostPlatform`, `host` and `inAppBrowser`. */
export const useDevice = (): UseDeviceResult => {
  const { device } = useSuperwallSnapshot();
  const landscape = useMediaQuery("(orientation: landscape)");

  return React.useMemo(
    () => ({
      ...device,
      orientation: landscape ? "landscape" : "portrait",
      hostPlatform: platformOf(device),
      host: hostOf(),
      inAppBrowser: inAppBrowser(),
      cutout: cutoutOf(modelOf(device)),
    }),
    [device, landscape],
  );
};
export type { DeviceCutout, DevicePlatform } from "../device";
export type { SuperwallHost } from "../host";
export type { SuperwallInAppBrowser } from "../browser";
