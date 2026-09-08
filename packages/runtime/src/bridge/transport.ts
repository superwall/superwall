import { buildTransport, TransportKind, type ITransport } from "@superwall/protocol";

export type RuntimeTransportDetectionOptions = {
  search?: string;
};

export const detectRuntimeTransportKind = (
  options: RuntimeTransportDetectionOptions = {},
): TransportKind => {
  if (typeof window === "undefined" && options.search === undefined) {
    return TransportKind.WebKitPostMessage;
  }
  const params = new URLSearchParams(options.search ?? window.location.search);
  if (params.get("platform") === "android") return TransportKind.Android;
  if (params.get("transport") === "editor") return TransportKind.EditorIframe;
  return TransportKind.WebKitPostMessage;
};

export const createRuntimeTransport = (
  kind: TransportKind = detectRuntimeTransportKind(),
): ITransport => buildTransport(kind);

export const detectSuperwallHost = (): boolean => {
  if (typeof window === "undefined") return false;
  if (window.webkit?.messageHandlers?.paywallMessageHandler) return true;
  if (typeof SWAndroid !== "undefined" && SWAndroid) return true;
  return detectRuntimeTransportKind() !== TransportKind.WebKitPostMessage;
};
