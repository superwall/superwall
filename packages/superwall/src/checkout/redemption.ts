import type { PostCheckoutResolution } from "./types";
import { fetchWithRetry } from "./api/fetch";
import type { PaywallSession } from "./flow";
import { field } from "./api/decode";

export type CompletedWebCheckout = {
  productIdentifier?: string;
  redemptionUrl?: string;
  deepLinkUrl?: string;
  postCheckoutRequestUrl?: string;
};

type Listener = () => void;

let completed: CompletedWebCheckout | undefined;
const listeners = new Set<Listener>();

const notify = () => {
  for (const listener of listeners) listener();
};

export const completedWebCheckout = {
  get: (): CompletedWebCheckout | undefined => completed,
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set: (value: CompletedWebCheckout | undefined) => {
    completed = value;
    notify();
  },
};

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const readCompletedWebCheckout = (input: unknown): CompletedWebCheckout => ({
  productIdentifier: asOptionalString(field(input, "productIdentifier")),
  redemptionUrl: asOptionalString(field(input, "redemptionUrl")),
  deepLinkUrl: asOptionalString(field(input, "deepLinkUrl")),
  postCheckoutRequestUrl: asOptionalString(field(input, "postCheckoutRequestUrl")),
});

export const resolveCompletedWebCheckout = async (
  paywall: Pick<PaywallSession, "getSnapshot" | "postMessage">,
  resolution: Exclude<PostCheckoutResolution, { type: "paywall" }>,
): Promise<void> => {
  const target = completed?.postCheckoutRequestUrl;
  if (!target) throw new Error("No completed web checkout to resolve.");

  const publicApiKey = paywall.getSnapshot().device.publicApiKey;
  const response = await fetchWithRetry(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(typeof publicApiKey === "string" && publicApiKey.startsWith("pk_")
        ? { Authorization: `Bearer ${publicApiKey}` }
        : {}),
    },
    body: JSON.stringify({ resolution }),
  });
  const body: unknown = await response.json();
  const url = asOptionalString(field(body, "redirectUrl"));
  if (!response.ok || !url) throw new Error("The post-checkout endpoint returned no URL.");
  paywall.postMessage({ event_name: "open_url", url });
};
