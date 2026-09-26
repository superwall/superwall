import type { TIncomingMessage, TOutgoingMessage } from "../messages";
import { decodeBase64Utf8, decodeIncomingMessages } from "./base64";
import { createTransportLogger, type ITransport, type TIncomingHandler } from "./shared";
import type { WebSdkEvents } from "./web-events";

const log = createTransportLogger("Web");

/**
 * The channel the Web SDK (`@superwall/paywalls-js`) stamps on every message
 * it sends the paywall: `{ version: 1, channel, payload }`, where `payload` is
 * a base64url JSON array of events — the same bytes iOS hands `accept64`.
 */
export const WEB_SDK_ACCEPT64_CHANNEL = "paywall.accept64";

export type WebSdkTransportOptions = {
  hostWindow: Window;
  /** The page framing the paywall; messages from any other origin are dropped. */
  hostOrigin: string;
  events?: WebSdkEvents | null;
  hosted?: boolean;
};

type Accept64Envelope = { channel: typeof WEB_SDK_ACCEPT64_CHANNEL; payload: string };

const isAccept64 = (data: unknown): data is Accept64Envelope =>
  typeof data === "object" &&
  data !== null &&
  (data as { channel?: unknown }).channel === WEB_SDK_ACCEPT64_CHANNEL &&
  typeof (data as { payload?: unknown }).payload === "string";

/**
 * The paywall framed by the Web SDK on a merchant's page. The SDK reads plain
 * objects (never the JSON strings the native bridges carry), in the v1
 * `{ version, payload: { events } }` envelope, and only from its own iframe.
 */
export class WebSdkTransport implements ITransport {
  private readonly hostWindow: Window;
  private readonly hostOrigin: string;
  private readonly events: WebSdkEvents | null;
  private readonly hosted: boolean;
  private handlers: TIncomingHandler[] = [];
  private listener: ((event: MessageEvent) => void) | undefined;

  constructor({ hostWindow, hostOrigin, events, hosted }: WebSdkTransportOptions) {
    this.hostWindow = hostWindow;
    this.hostOrigin = hostOrigin;
    this.events = events ?? null;
    this.hosted = hosted ?? false;
  }

  postMessage(message: TOutgoingMessage): void {
    this.events?.observe(message);
    const sent =
      this.hosted && message.event_name === "ping"
        ? { ...message, host_controlled: true }
        : message;
    this.hostWindow.postMessage({ version: 1, payload: { events: [sent] } }, this.hostOrigin);
    log.info("Sent message to the Web SDK via postMessage");
  }

  addListener(handler: TIncomingHandler): void {
    this.handlers.push(handler);
  }

  startListening(): void {
    if (this.listener) return;
    this.listener = (event: MessageEvent) => {
      if (event.source !== this.hostWindow) return;
      if (this.hostOrigin !== "*" && event.origin !== this.hostOrigin) return;
      if (!isAccept64(event.data)) return;
      let messages: TIncomingMessage[];
      try {
        messages = decodeIncomingMessages(event.data.payload);
      } catch (error) {
        log.error("Failed to decode a Web SDK message", error);
        return;
      }
      for (const message of messages) this.accept(message);
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

/** The framing page's origin, as the Web SDK passes it in `?host_origin=`. */
export const webSdkHostOrigin = (search: string = window.location.search): string => {
  const origin = new URLSearchParams(search).get("host_origin");
  if (!origin) return "*";
  try {
    return new URL(origin).origin;
  } catch {
    return "*";
  }
};

export const webSdkHostsPaywall = (hash: string = window.location.hash): boolean => {
  if (!hash.startsWith("#init=")) return false;
  try {
    const payload: unknown = JSON.parse(decodeBase64Utf8(hash.slice("#init=".length)));
    return (
      typeof payload === "object" &&
      payload !== null &&
      (payload as { hostsFrameworkPaywalls?: unknown }).hostsFrameworkPaywalls === true
    );
  } catch {
    return false;
  }
};
