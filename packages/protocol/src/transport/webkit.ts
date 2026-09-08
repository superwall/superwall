import type { TIncomingMessage, TOutgoingMessage } from "../messages";
import {
  createTransportLogger,
  MessageDirection,
  wrap,
  type ITransport,
  type TIncomingHandler,
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
    app?: {
      messages?: unknown[];
      [member: string]: unknown;
    };
  }
}

export const pendingHostMessages = (): unknown[] => {
  if (typeof window === "undefined") return [];
  const host = (window.app ??= {});
  return (host.messages ??= []);
};

export class WebKitTransport implements ITransport {
  private handlers: TIncomingHandler[] = [];
  private listening = false;

  postMessage(message: TOutgoingMessage): void {
    const wrapped = wrap(message, MessageDirection.FromPaywall);
    const handler = window.webkit?.messageHandlers?.paywallMessageHandler;
    if (handler) {
      log.info("Sending message via WebKit message handler");
      handler.postMessage(wrapped);
      return;
    }
    log.warn("No message handler yet - queueing for the host to drain");
    pendingHostMessages().push(wrapped);
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
