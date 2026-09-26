import { TransportKind } from "./kind";
import { AndroidTransport } from "./android";
import { EditorTransport } from "./editor";
import type { ITransport } from "./shared";
import { WebKitTransport } from "./webkit";
import { WebSdkTransport, webSdkHostOrigin, webSdkHostsPaywall } from "./web";
import { WebSdkEvents } from "./web-events";

export const buildTransport = (kind: TransportKind): ITransport => {
  switch (kind) {
    case TransportKind.Android:
      return new AndroidTransport();
    case TransportKind.WebKitPostMessage:
      return new WebKitTransport();
    case TransportKind.EditorIframe:
      return new EditorTransport({ targetWindow: window.parent, targetOrigin: "*" });
    case TransportKind.WebSdk: {
      const hosted = webSdkHostsPaywall();
      return new WebSdkTransport({
        hostWindow: window.parent,
        hostOrigin: webSdkHostOrigin(),
        events: hosted ? null : WebSdkEvents.fromLocation(),
        hosted,
      });
    }
  }
};

export { AndroidTransport } from "./android";
export { EditorTransport, type EditorTransportOptions } from "./editor";
export {
  MessageDirection,
  unwrap,
  wrap,
  type ITransport,
  type TIncomingHandler,
  type WrappedMessage,
} from "./shared";
export { pendingHostMessages, WebKitTransport } from "./webkit";
export {
  WEB_SDK_ACCEPT64_CHANNEL,
  WebSdkTransport,
  webSdkHostOrigin,
  webSdkHostsPaywall,
  type WebSdkTransportOptions,
} from "./web";
export {
  WebSdkEvents,
  webSdkEventsInit,
  type WebSdkCollector,
  type WebSdkEventsInit,
} from "./web-events";
export { decodeBase64Utf8, decodeIncomingMessages } from "./base64";
export { TransportKind } from "./kind";
