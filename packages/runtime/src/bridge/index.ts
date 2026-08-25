import type {
  ITransport,
  TIncomingHandler,
  TIncomingMessage,
  TOutgoingMessage,
  TransportKind,
} from "@superwall/protocol";
import { decodeIncomingMessages } from "./base64";
import { createRuntimeTransport, detectRuntimeTransportKind } from "./transport";

export type SuperwallMessageLogEntry =
  | { ts: Date; msg: TIncomingMessage; type: "incoming" }
  | { ts: Date; msg: TOutgoingMessage; type: "outgoing" };

export type SuperwallBridgeOptions = {
  transport?: ITransport;
  transportKind?: TransportKind;
  now?: () => Date;
  onDecodeError?: (error: unknown) => void;
};

export class SuperwallBridge {
  private transport: ITransport;
  private incomingHandlers: TIncomingHandler[] = [];
  private now: () => Date;
  private onDecodeError?: (error: unknown) => void;

  public messages: SuperwallMessageLogEntry[] = [];

  constructor(options: SuperwallBridgeOptions = {}) {
    this.transport =
      options.transport ??
      createRuntimeTransport(options.transportKind ?? detectRuntimeTransportKind());
    this.now = options.now ?? (() => new Date());
    this.onDecodeError = options.onDecodeError;

    this.transport.addListener((message) => {
      this.messages.push({ ts: this.now(), msg: message, type: "incoming" });
      this.incomingHandlers.forEach((handler) => {
        handler(message);
      });
    });
  }

  public start() {
    this.transport.startListening();
  }

  public addListener(handler: TIncomingHandler) {
    this.incomingHandlers.push(handler);
    return () => {
      this.incomingHandlers = this.incomingHandlers.filter((candidate) => candidate !== handler);
    };
  }

  public postMessage(message: TOutgoingMessage) {
    this.messages.push({ ts: this.now(), msg: message, type: "outgoing" });
    this.transport.postMessage(message);
  }

  public accept(messages: TIncomingMessage[]) {
    messages.forEach((message) => {
      this.transport.accept(message);
    });
  }

  public accept64(message: string) {
    try {
      this.accept(decodeIncomingMessages(message));
    } catch (error) {
      this.onDecodeError?.(error);
    }
  }
}

export const createSuperwallBridge = (options: SuperwallBridgeOptions = {}) =>
  new SuperwallBridge(options);
