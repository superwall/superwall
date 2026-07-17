import { TIncomingMessage, TOutgoingMessage } from "../messages";

const isTransportDebugEnabled = () => {
  if (typeof localStorage === "undefined" || !localStorage) return false;
  return localStorage?.getItem("SW_DEBUG_TRANSPORT") === "true";
};

const TRANSPORT_COLORS: Record<string, string> = {
  WebKit: "#9C27B0", // Purple
  Android: "#4CAF50", // Green
  Editor: "#2196F3", // Blue
  Transport: "#FF9800", // Orange
};

export const createTransportLogger = (transportName: string) => {
  const color = TRANSPORT_COLORS[transportName] || "#999";

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

export type WrappedMessagePayload<T extends TMessage> = {
  events: T[];
};

export type WrappedMessage<T extends TMessage> = {
  version: 1;
  direction: MessageDirection;
  payload: {
    events: T[];
  };
};

export const wrap = <T extends TMessage>(message: T | T[], messageDirection: MessageDirection) => {
  var events: T[];
  if (!Array.isArray(message)) {
    events = [message];
  } else {
    events = message;
  }
  const payload: WrappedMessage<T> = {
    direction: messageDirection,
    version: 1,
    payload: {
      events,
    },
  };
  return JSON.stringify(payload);
};

type Validator<T extends TMessage> = {
  parse: (arg0: object) => WrappedMessage<T>;
};

const buildNopValidator = <T extends TMessage>() => {
  return {
    parse: (arg0: object) => {
      return arg0 as WrappedMessage<T>;
    },
  };
};

const sharedLogger = createTransportLogger("Transport");

export const unwrap = <T extends TMessage>(
  message: string,
  messageDirection: MessageDirection,
  validator: Validator<T> = buildNopValidator(),
): T[] => {
  try {
    let parsed = JSON.parse(message);
    let validated = validator.parse(parsed);
    if (validated.direction !== messageDirection) {
      throw new Error("Message direction incorrect");
    }
    return validated.payload.events;
  } catch (e) {
    sharedLogger.error("Failed to parse incoming message", { message, error: e });
    return [];
  }
};
