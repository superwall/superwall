import { TIncomingMessage, TOutgoingMessage } from "../messages";
import {
  createTransportLogger,
  ITransport,
  MessageDirection,
  TIncomingHandler,
  wrap,
} from "./shared";

const log = createTransportLogger("Android");

declare global {
  /**
   * Injected by the Android SDK's JavascriptInterface; absent in every other
   * environment. Not part of any lib types, so the host contract is declared
   * here.
   */
  // eslint-disable-next-line no-var
  var SWAndroid: { postMessage: (message: string) => void } | undefined;
}

export const buildAndroidTransport = (): AndroidTransport => {
  return new AndroidTransport();
};

class AndroidTransport implements ITransport {
  postMessage(messages: TOutgoingMessage | TOutgoingMessage[]): void {
    log.debug("Attempting to send messages", messages);

    if (typeof SWAndroid !== "undefined" && SWAndroid) {
      const wrappedOutgoingMessage = wrap(messages, MessageDirection.FromPaywall);
      log.debug("Wrapped message for transport", wrappedOutgoingMessage);

      SWAndroid.postMessage(wrappedOutgoingMessage);
      log.info("Sent message via SWAndroid interface");
      return;
    }

    log.warn("Unable to send message - SWAndroid interface not available");
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
