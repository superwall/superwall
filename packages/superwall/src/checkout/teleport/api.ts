import { field, readCheckoutStatus } from "../api/decode";
import type { CheckoutStatus } from "../types";
import { fetchWithRetry } from "../api/fetch";
import { subscriptionsApiUrl } from "../api/url";
import { SESSION_QUERY_FIELD, sessionQueryOf } from "./boot";

export type CreatedTeleport = { teleportId: string; url: string };

export type TeleportStatus = {
  status: "pending" | "claimed" | "completed" | "expired";
  checkoutContextId?: string;
  checkoutProductIdentifier?: string;
};

export type TeleportRequest = {
  route: string;
  productReference?: string;
  presentationId: string;
  context: Record<string, unknown>;
  session: Record<string, unknown>;
};

const STATUSES = ["pending", "claimed", "completed", "expired"] as const;
const STATUS_TIMEOUT_MS = 10_000;

const headers = (publicApiKey: string): HeadersInit => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${publicApiKey}`,
});

const text = (body: unknown, key: string): string | undefined => {
  const value = field(body, key);
  return typeof value === "string" && value !== "" ? value : undefined;
};

export const createTeleport = async (
  publicApiKey: string,
  request: TeleportRequest,
): Promise<CreatedTeleport> => {
  const response = await fetchWithRetry(subscriptionsApiUrl("checkout/teleport"), {
    method: "POST",
    headers: headers(publicApiKey),
    body: JSON.stringify({
      store: "stripe",
      route: request.route,
      ...(request.productReference === undefined
        ? {}
        : { productReference: request.productReference }),
      presentationId: request.presentationId,
      context: request.context,
      session: request.session,
    }),
  });
  const body: unknown = await response.json();
  const teleportId = text(body, "teleportId");
  const url = text(body, "url");
  if (teleportId === undefined || url === undefined) {
    throw new Error("The teleport backend returned no teleport id or link.");
  }
  return { teleportId, url };
};

export const readTeleportStatus = async (
  publicApiKey: string,
  teleportId: string,
): Promise<TeleportStatus> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetchWithRetry(
      subscriptionsApiUrl("checkout/teleport/status"),
      {
        method: "POST",
        headers: headers(publicApiKey),
        body: JSON.stringify({ teleportId }),
        signal: controller.signal,
      },
      { retries: 0 },
    );
    body = await response.json();
  } finally {
    clearTimeout(timer);
  }
  const status = STATUSES.find((candidate) => candidate === field(body, "status")) ?? "pending";
  const checkoutContextId = text(body, "checkoutContextId");
  const checkoutProductIdentifier = text(body, "checkoutProductIdentifier");
  return {
    status,
    ...(checkoutContextId === undefined ? {} : { checkoutContextId }),
    ...(checkoutProductIdentifier === undefined ? {} : { checkoutProductIdentifier }),
  };
};

export const readCheckoutOf = async (
  publicApiKey: string,
  checkoutContextId: string,
): Promise<CheckoutStatus["status"]> => {
  const response = await fetchWithRetry(
    subscriptionsApiUrl("checkout/status"),
    {
      method: "POST",
      headers: headers(publicApiKey),
      body: JSON.stringify({ checkoutId: checkoutContextId }),
    },
    { retries: 0 },
  );
  return readCheckoutStatus(await response.json()).status;
};

export const readTeleportQuery = async (
  publicApiKey: string,
  teleportId: string,
): Promise<Record<string, string>> => {
  const response = await fetchWithRetry(subscriptionsApiUrl("checkout/teleport/session/read"), {
    method: "POST",
    headers: headers(publicApiKey),
    body: JSON.stringify({ teleportId }),
  });
  return sessionQueryOf(field(await response.json(), "session"));
};

export const saveTeleportQuery = async (
  publicApiKey: string,
  teleportId: string,
  query: Record<string, string>,
): Promise<boolean> => {
  const response = await fetch(subscriptionsApiUrl("checkout/teleport/session"), {
    method: "POST",
    headers: headers(publicApiKey),
    body: JSON.stringify({ teleportId, session: { [SESSION_QUERY_FIELD]: query } }),
  });
  if (!response.ok) return false;
  return field(await response.json(), "saved") === true;
};

export const moveTeleportIntroductoryOffer = async (
  publicApiKey: string,
  teleportId: string,
  hasIntroductoryOffer: boolean,
): Promise<boolean> => {
  const response = await fetch(subscriptionsApiUrl("checkout/teleport/introductory-offer"), {
    method: "POST",
    headers: headers(publicApiKey),
    body: JSON.stringify({ teleportId, hasIntroductoryOffer }),
  });
  if (!response.ok) return false;
  return field(await response.json(), "updated") === true;
};

const WARMED_PRODUCTS = 4;

export const warmTeleportPage = (url: string, references: readonly string[]): void => {
  const products = references.length > 0 ? references.slice(0, WARMED_PRODUCTS) : [undefined];
  for (const reference of products) {
    const warm = new URL(url);
    warm.searchParams.set("sw_warm", "1");
    if (reference !== undefined) warm.searchParams.set("sw_ref", reference);
    fetch(warm.toString(), { method: "GET", mode: "no-cors", credentials: "omit" }).catch(
      () => undefined,
    );
  }
};

export const completeTeleportCheckout = async (
  publicApiKey: string,
  checkoutContextId: string,
): Promise<void> => {
  await fetchWithRetry(subscriptionsApiUrl("checkout/session/complete"), {
    method: "POST",
    keepalive: true,
    headers: headers(publicApiKey),
    body: JSON.stringify({ checkoutContextId }),
  });
};

export const teleportStatusUrls = () => ({
  teleport_status_url: subscriptionsApiUrl("checkout/teleport/status"),
  checkout_status_url: subscriptionsApiUrl("checkout/status"),
});
