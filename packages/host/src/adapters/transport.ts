import type { ITransport, TIncomingHandler, TIncomingMessage } from "@superwall/protocol";
import {
  createPaywallHost,
  type HostSend,
  type PaywallHost,
  type PaywallHostOptions,
} from "../host";

export type HostTransportOptions = Omit<PaywallHostOptions, "send"> & {
  latencyMs?: number;
};

export const createHostTransport = (
  options: HostTransportOptions,
): { transport: ITransport; host: PaywallHost } => {
  const handlers: TIncomingHandler[] = [];
  let listening = false;

  const deliver = (events: readonly TIncomingMessage[]) => {
    if (!listening) return;
    for (const event of events) {
      for (const handler of handlers) handler(event);
    }
  };

  const latency = options.latencyMs ?? 0;
  const send: HostSend = (events) => {
    if (latency > 0) setTimeout(() => deliver(events), latency);
    else queueMicrotask(() => deliver(events));
  };

  const { latencyMs: _latencyMs, ...hostOptions } = options;
  const host = createPaywallHost({ ...hostOptions, send });

  const transport: ITransport = {
    postMessage: (message) => {
      host.receive([message]);
    },
    accept: (message) => {
      deliver([message]);
    },
    addListener: (handler) => {
      handlers.push(handler);
    },
    startListening: () => {
      listening = true;
    },
  };

  return { transport, host };
};
