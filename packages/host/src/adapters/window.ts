import { MessageDirection, unwrap, wrap, type TOutgoingMessage } from "@superwall/protocol";
import {
  createPaywallHost,
  type HostSend,
  type PaywallHost,
  type PaywallHostOptions,
} from "../host";

export const windowSender =
  (target: Window): HostSend =>
  (events) => {
    target.postMessage(wrap([...events], MessageDirection.ToPaywall), "*");
  };

export type AttachOptions = {
  listen?: Window;
};

export const attachToWindow = (
  host: PaywallHost,
  target: Window,
  options: AttachOptions = {},
): (() => void) => {
  const scope = options.listen ?? window;
  const listener = (event: MessageEvent) => {
    if (event.source !== target || typeof event.data !== "string") return;
    const events = unwrap<TOutgoingMessage>(event.data, MessageDirection.FromPaywall);
    if (events.length > 0) host.receive(events);
  };
  scope.addEventListener("message", listener);
  return () => scope.removeEventListener("message", listener);
};

export type WindowHostOptions = Omit<PaywallHostOptions, "send"> &
  AttachOptions & {
    target: Window;
  };

export const createWindowHost = (
  options: WindowHostOptions,
): { host: PaywallHost; detach: () => void } => {
  const { target, listen, ...hostOptions } = options;
  const host = createPaywallHost({ ...hostOptions, send: windowSender(target) });
  const detach = attachToWindow(host, target, listen ? { listen } : {});
  return { host, detach };
};
