import { detectRuntimeTransportKind, TransportKind } from "@superwall/runtime";
import { readTeleportBoot } from "./checkout/teleport/boot";

export type SuperwallHost =
  | "ios-sdk"
  | "android-sdk"
  | "web-sdk"
  | "web-paywall"
  | "web-teleport"
  | "studio"
  | "browser";

type WebPaywallController = { props?: { clientSurface?: unknown } };

const webController = (): WebPaywallController | undefined =>
  (window as typeof window & { webPaywallCtrl?: WebPaywallController }).webPaywallCtrl;

const clientSurface = (): unknown =>
  webController()?.props?.clientSurface ??
  new URLSearchParams(window.location.search).get("client_surface");

export const hostOf = (): SuperwallHost => {
  const transport = detectRuntimeTransportKind();
  if (transport === TransportKind.EditorIframe) return "studio";
  if (window.webkit?.messageHandlers?.paywallMessageHandler) return "ios-sdk";
  if (transport === TransportKind.Android || (typeof SWAndroid !== "undefined" && SWAndroid)) {
    return "android-sdk";
  }
  if (clientSurface() === "web-sdk") return "web-sdk";
  if (readTeleportBoot() !== undefined) return "web-teleport";
  if (webController() !== undefined || clientSurface() === "web-direct") return "web-paywall";
  return "browser";
};
