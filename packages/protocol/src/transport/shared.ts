import type { TIncomingMessage, TOutgoingMessage } from "../messages";

const isTransportDebugEnabled = () =>
  typeof localStorage !== "undefined" && localStorage.getItem("SW_DEBUG_TRANSPORT") === "true";

const TRANSPORT_COLORS: Record<string, string> = {
  WebKit: "#9C27B0",
  Android: "#4CAF50",
  Editor: "#2196F3",
  Transport: "#FF9800",
};

export const createTransportLogger = (transportName: string) => {
  const color = TRANSPORT_COLORS[transportName] ?? "#999";

  const log = (level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]) => {
    if (!isTransportDebugEnabled() && level === "debug") return;

    const prefix = `%c[${transportName}]%c ${message}`;
    const styles = [`color: ${color}; font-weight: bold`, "color: inherit"];

    switch (level) {
      case "error":
        console.error(prefix, ...styles, ...args);
        break;
      case "warn":
        console.warn(prefix, ...styles, ...args);
        break;
      case "info":
        console.info(prefix, ...styles, ...args);
        break;
      default:
        console.log(prefix, ...styles, ...args);
    }
  };

  return {
    debug: (message: string, ...args: unknown[]) => log("debug", message, ...args),
    info: (message: string, ...args: unknown[]) => log("info", message, ...args),
    warn: (message: string, ...args: unknown[]) => log("warn", message, ...args),
    error: (message: string, ...args: unknown[]) => log("error", message, ...args),
  };
};

export type TIncomingHandler = (message: TIncomingMessage) => void;

export type TMessage = TIncomingMessage | TOutgoingMessage;

export interface ITransport {
  postMessage(message: TOutgoingMessage): void;
  accept(message: TIncomingMessage): void;
  addListener(handler: TIncomingHandler): void;
  startListening(): void;
}

export enum MessageDirection {
  ToPaywall = "to_paywall",
  FromPaywall = "from_paywall",
  ToPaywallUi = "to_paywall_ui",
  FromPaywallUi = "from_paywall_ui",
}

export type WrappedMessage<T extends TMessage> = {
  version: 1;
  direction: MessageDirection;
  payload: {
    events: T[];
  };
};

export const wrap = <T extends TMessage>(
  message: T | T[],
  messageDirection: MessageDirection,
): string => {
  const payload: WrappedMessage<T> = {
    direction: messageDirection,
    version: 1,
    payload: { events: Array.isArray(message) ? message : [message] },
  };
  return JSON.stringify(payload);
};

type Validator<T extends TMessage> = {
  parse: (value: object) => WrappedMessage<T>;
};

// The wire is trusted for forward compatibility: an unknown message from a
// newer host must reach the paywall rather than drop the whole batch.
const trustingValidator = <T extends TMessage>(): Validator<T> => ({
  parse: (value) => value as WrappedMessage<T>,
});

const sharedLogger = createTransportLogger("Transport");

export const unwrap = <T extends TMessage>(
  message: string,
  messageDirection: MessageDirection,
  validator: Validator<T> = trustingValidator(),
): T[] => {
  try {
    const validated = validator.parse(JSON.parse(message));
    if (validated.direction !== messageDirection) {
      throw new Error("Message direction incorrect");
    }
    return validated.payload.events;
  } catch (error) {
    sharedLogger.error("Failed to parse incoming message", { message, error });
    return [];
  }
};
