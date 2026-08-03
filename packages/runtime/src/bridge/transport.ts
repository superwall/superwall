import { buildTransport, TransportKind, type ITransport } from "@superwall/protocol";

export { pendingHostMessages } from "@superwall/protocol";

export type RuntimeTransportDetectionOptions = {
  search?: string;
};

export const detectRuntimeTransportKind = (
  options: RuntimeTransportDetectionOptions = {},
): TransportKind => {
  if (typeof window === "undefined" && options.search === undefined) {
    return TransportKind.WebKitPostMessage;
  }

  const search = options.search ?? window.location.search;
  const urlParams = new URLSearchParams(search);

  if (urlParams.get("platform") === "android") {
    return TransportKind.Android;
  }

  if (urlParams.get("transport") === "editor") {
    return TransportKind.EditorIframe;
  }

  return TransportKind.WebKitPostMessage;
};

export const createRuntimeTransport = (
  transportKind: TransportKind = detectRuntimeTransportKind(),
): ITransport => buildTransport(transportKind);

/**
 * Detects the explicit `?sw_preview` opt-in that lets a page simulate the SDK
 * without a native host present. "auto" mock mode requires it, so a built
 * snapshot can never downgrade itself to placeholder products by accident.
 */
export const detectPreviewOptIn = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return new URLSearchParams(window.location.search).has("sw_preview");
};

export const detectNativeSuperwallHost = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  // window.webkit and SWAndroid are declared globally by @superwall/protocol's
  // transports — the SDK-injected host contract.
  if (window.webkit?.messageHandlers?.paywallMessageHandler) {
    return true;
  }

  if (typeof SWAndroid !== "undefined" && SWAndroid) {
    return true;
  }

  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("platform") === "android" || urlParams.get("transport") === "editor";
};
