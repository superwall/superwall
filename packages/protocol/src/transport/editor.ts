import type { TIncomingMessage, TOutgoingMessage } from "../messages";
import {
  createTransportLogger,
  MessageDirection,
  unwrap,
  wrap,
  type ITransport,
  type TIncomingHandler,
} from "./shared";

const log = createTransportLogger("Editor");

export type EditorTransportOptions = {
  targetWindow: Window;
  targetOrigin: string;
};

export class EditorTransport implements ITransport {
  private readonly targetWindow: Window;
  private readonly targetOrigin: string;
  private handlers: TIncomingHandler[] = [];
  private listener: ((event: MessageEvent) => void) | undefined;

  constructor({ targetWindow, targetOrigin }: EditorTransportOptions) {
    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;
  }

  postMessage(message: TOutgoingMessage): void {
    this.targetWindow.postMessage(wrap(message, MessageDirection.FromPaywall), this.targetOrigin);
    log.info("Sent message to editor via postMessage");
  }

  addListener(handler: TIncomingHandler): void {
    this.handlers.push(handler);
  }

  startListening(): void {
    if (this.listener) return;
    this.listener = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      for (const message of unwrap<TIncomingMessage>(event.data, MessageDirection.ToPaywall)) {
        this.accept(message);
      }
    };
    window.addEventListener("message", this.listener);
  }

  stopListening(): void {
    if (!this.listener) return;
    window.removeEventListener("message", this.listener);
    this.listener = undefined;
  }

  accept(message: TIncomingMessage): void {
    if (!this.listener) return;
    this.handlers.forEach((handler) => handler(message));
  }
}
