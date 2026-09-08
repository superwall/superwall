import { TransportKind } from "./kind";
import { AndroidTransport } from "./android";
import { EditorTransport } from "./editor";
import type { ITransport } from "./shared";
import { WebKitTransport } from "./webkit";

export const buildTransport = (kind: TransportKind): ITransport => {
  switch (kind) {
    case TransportKind.Android:
      return new AndroidTransport();
    case TransportKind.WebKitPostMessage:
      return new WebKitTransport();
    case TransportKind.EditorIframe:
      return new EditorTransport({ targetWindow: window.parent, targetOrigin: "*" });
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
export { TransportKind } from "./kind";
