import type { SuperwallMockOptions, TOutgoingMessage } from "@superwall/runtime";

export type StudioAskKind = "purchase" | "permission" | "callback";

export type StudioBridgeMessage =
  | { channel: "superwall-studio"; type: "hello"; locales: string[] }
  | { channel: "superwall-studio"; type: "event"; message: TOutgoingMessage }
  | {
      channel: "superwall-studio";
      type: "ask";
      id: string;
      kind: StudioAskKind;
      subject: string;
    }
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

export const announceToStudio = (details: { locales: string[] }): void => {
  embedded()?.postMessage({ channel: STUDIO_CHANNEL, type: "hello", ...details }, "*");
};

export const studioBridge = (): Partial<SuperwallMockOptions> => {
  const parent = embedded();
  if (!parent) return {};

  const post = (message: StudioBridgeMessage) => parent.postMessage(message, "*");

  const ask = (kind: StudioAskKind, subject: string): Promise<string> =>
    new Promise((resolve) => {
      const id = `${kind}-${(asked += 1)}`;
      const settle = (event: MessageEvent) => {
        if (!isAnswer(event.data, id)) return;
        window.removeEventListener("message", settle);
        resolve(event.data.outcome);
      };
      window.addEventListener("message", settle);
      post({ channel: STUDIO_CHANNEL, type: "ask", id, kind, subject });
    });

  return {
    onOutgoing: (message) => post({ channel: STUDIO_CHANNEL, type: "event", message }),

    purchaseOutcome: ({ reference }) =>
      ask("purchase", reference).then((outcome) =>
        outcome === "abandoned" ? "abandoned" : "completed",
      ),

    onPermission: (type) =>
      ask("permission", type).then((outcome) => (outcome === "denied" ? "denied" : "granted")),

    onCallback: (name) =>
      ask("callback", name).then((outcome) =>
        outcome === "failure" ? { status: "failure" as const } : { status: "success" as const },
      ),
  };
};
