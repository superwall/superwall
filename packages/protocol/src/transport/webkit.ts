import { TIncomingMessage, TOutgoingMessage } from "../messages";
import {
  createTransportLogger,
  ITransport,
  MessageDirection,
  TIncomingHandler,
  wrap,
} from "./shared";

const log = createTransportLogger("WebKit");

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        paywallMessageHandler?: {
          postMessage: (message: unknown) => void;
        };
      };
    };
  }
}

export const buildWebKitTransport = (): WebKitTransport => {
  return new WebKitTransport();
};

class WebKitTransport implements ITransport {
  postMessage(messages: TOutgoingMessage | TOutgoingMessage[]): void {
    log.debug("Attempting to send messages", messages);

    const paywallMessageHandler = window.webkit?.messageHandlers?.paywallMessageHandler;
    log.debug("Checking window.webkit availability", {
      hasWebkit: !!window.webkit,
      hasMessageHandlers: !!window.webkit?.messageHandlers,
      hasPaywallHandler: !!paywallMessageHandler,
    });

    const wrappedOutgoingMessage = wrap(messages, MessageDirection.FromPaywall);
    log.debug("Wrapped message for transport", wrappedOutgoingMessage);

    if (paywallMessageHandler) {
      log.info("Sending message via WebKit message handler");
      paywallMessageHandler.postMessage(wrappedOutgoingMessage);
      return;
    }

    log.warn("Unable to send message - WebKit message handler not available");
  }
  private _handlers: TIncomingHandler[] = [];
  addListener(handler: TIncomingHandler): void {
    this._handlers.push(handler);
  }

  private _listening = false;

  startListening() {
    this._listening = true;
  }

  accept(message: TIncomingMessage) {
    if (this._listening) {
      this._handlers.forEach((handler) => handler(message));
    }
  }
}
