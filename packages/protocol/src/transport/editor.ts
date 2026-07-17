import { TIncomingMessage, TOutgoingMessage } from "../messages";
import {
  createTransportLogger,
  ITransport,
  MessageDirection,
  TIncomingHandler,
  unwrap,
  wrap,
} from "./shared";

const log = createTransportLogger("Editor");

/**
 * Editor transport assumes we are loaded in an iframe in the editor
 */
export class EditorTransport implements ITransport {
  constructor({ targetWindow, targetOrigin }: { targetWindow: Window; targetOrigin: string }) {
    this._targetWindow = targetWindow;
    this._targetOrigin = targetOrigin;
  }

  private _targetWindow: Window;
  private _targetOrigin: string;

  postMessage(messages: TOutgoingMessage | TOutgoingMessage[]): void {
    const wrappedOutgoingMessage = wrap(messages, MessageDirection.FromPaywall);
    log.debug("Wrapped message for editor", wrappedOutgoingMessage);
    this._targetWindow.postMessage(wrappedOutgoingMessage, this._targetOrigin);
    log.info("Sent message to editor via postMessage");
  }

  private _handlers: TIncomingHandler[] = [];
  addListener(handler: TIncomingHandler): void {
    this._handlers.push(handler);
  }

  /**
   * In order for `window.removeEventListener` to work we need to pass the same
   * exact function that we used for `addListener`. This is a way to cache that
   * value because `.bind(this)` creates a new function each call.
   *
   * This also implicitly tracks state about if we're listening or not,
   * `undefined` meaning not listening
   *
   */
  private _listeningRef: ((event: MessageEvent) => void) | undefined = undefined;

  startListening() {
    if (this._listeningRef !== undefined) {
      return;
    }
    this._listeningRef = this._onRawMessageReceived.bind(this);
    window.addEventListener("message", this._listeningRef);
  }

  stopListening() {
    if (this._listeningRef === undefined) {
      return;
    }
    window.removeEventListener("message", this._listeningRef);
    this._listeningRef = undefined;
  }

  private _onRawMessageReceived(event: MessageEvent) {
    if (event.data && typeof event.data === "string") {
      let events = unwrap<TIncomingMessage>(event.data, MessageDirection.ToPaywall);
      events.forEach((message) => {
        this.accept(message);
      });
    }
  }

  accept(message: TIncomingMessage) {
    if (this._listeningRef) {
      this._handlers.forEach((handler) => handler(message));
    }
  }
}
