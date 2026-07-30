import type { SuperwallMockOptions, TOutgoingMessage } from "@superwall/runtime";

export type StudioBridgeMessage =
  | { channel: "superwall-studio"; type: "event"; message: TOutgoingMessage }
  | { channel: "superwall-studio"; type: "ask"; id: string; kind: "purchase"; reference: string }
  | { channel: "superwall-studio"; type: "answer"; id: string; outcome: string };

export const STUDIO_CHANNEL = "superwall-studio";

const embedded = (): Window | undefined => {
  if (typeof window === "undefined") return undefined;
  return window.parent !== window ? window.parent : undefined;
};

const isAnswer = (
  data: unknown,
  id: string,
): data is Extract<StudioBridgeMessage, { type: "answer" }> =>
  typeof data === "object" &&
  data !== null &&
  Reflect.get(data, "channel") === STUDIO_CHANNEL &&
  Reflect.get(data, "type") === "answer" &&
  Reflect.get(data, "id") === id;

let asked = 0;

export const studioBridge = (): Partial<SuperwallMockOptions> => {
  const parent = embedded();
  if (!parent) return {};

  const post = (message: StudioBridgeMessage) => parent.postMessage(message, window.origin);

  return {
    onOutgoing: (message) => post({ channel: STUDIO_CHANNEL, type: "event", message }),

    purchaseOutcome: ({ reference }) =>
      new Promise((resolve) => {
        const id = `purchase-${(asked += 1)}`;
        const settle = (event: MessageEvent) => {
          if (!isAnswer(event.data, id)) return;
          window.removeEventListener("message", settle);
          resolve(event.data.outcome === "abandoned" ? "abandoned" : "completed");
        };
        window.addEventListener("message", settle);
        post({ channel: STUDIO_CHANNEL, type: "ask", id, kind: "purchase", reference });
      }),
  };
};
