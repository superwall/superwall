import type {
  ITransport,
  TIncomingHandler,
  TIncomingMessage,
  TOutgoingMessage,
} from "@superwall/protocol";

/**
 * In-memory transport for fixture tests: outgoing messages are recorded,
 * incoming messages are injected with `accept`.
 */
export class TestTransport implements ITransport {
  public outgoing: TOutgoingMessage[] = [];
  private handlers: TIncomingHandler[] = [];
  private listening = false;

  postMessage(message: TOutgoingMessage) {
    this.outgoing.push(message);
  }

  accept(message: TIncomingMessage) {
    if (!this.listening) return;
    this.handlers.forEach((handler) => handler(message));
  }

  addListener(handler: TIncomingHandler) {
    this.handlers.push(handler);
  }

  startListening() {
    this.listening = true;
  }
}

export const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
