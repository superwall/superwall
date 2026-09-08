import type { TIncomingMessage, TOutgoingMessage } from "../messages";
import {
  createTransportLogger,
  MessageDirection,
  wrap,
  type ITransport,
  type TIncomingHandler,
} from "./shared";

const log = createTransportLogger("Android");

declare global {
  // eslint-disable-next-line no-var
  var SWAndroid: { postMessage: (message: string) => void } | undefined;
}

export class AndroidTransport implements ITransport {
  private handlers: TIncomingHandler[] = [];
  private listening = false;

  postMessage(message: TOutgoingMessage): void {
    if (typeof SWAndroid === "undefined" || !SWAndroid) {
      log.warn("Unable to send message - SWAndroid interface not available");
      return;
    }
    SWAndroid.postMessage(wrap(message, MessageDirection.FromPaywall));
    log.info("Sent message via SWAndroid interface");
  }

  addListener(handler: TIncomingHandler): void {
    this.handlers.push(handler);
  }

  startListening(): void {
    this.listening = true;
  }

  accept(message: TIncomingMessage): void {
    if (!this.listening) return;
    this.handlers.forEach((handler) => handler(message));
  }
}
