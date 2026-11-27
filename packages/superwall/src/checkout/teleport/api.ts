import { field, readCheckoutFailure, readCheckoutStatus } from "../api/decode";
import type { CheckoutFailure } from "../failure";
import type { CheckoutStatus } from "../types";
import { fetchWithRetry } from "../api/fetch";
import { subscriptionsApiUrl } from "../api/url";
import { SESSION_QUERY_FIELD, sessionQueryOf, TAPPED_PRODUCT_QUERY_KEY } from "./boot";
import type { PageReturn, TeleportData, TeleportDataValue } from "./teleporter";

export type CreatedTeleport = { teleportId: string; url: string };

export type ServerTeleport = {
  status: "pending" | "claimed" | "completed" | "expired";
  checkoutContextId?: string;
  checkoutProductIdentifier?: string;
  /** A paid custom store checkout's transaction id: the app reports the purchase with it. */
  customTransactionId?: string;
  failure?: CheckoutFailure;
};

export type NewTeleport = {
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
  request: NewTeleport,
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
): Promise<ServerTeleport> => {
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
  const customTransactionId = text(body, "customTransactionId");
  const failure = readCheckoutFailure(field(body, "failure"));
  return {
    status,
    ...(checkoutContextId === undefined ? {} : { checkoutContextId }),
    ...(checkoutProductIdentifier === undefined ? {} : { checkoutProductIdentifier }),
    ...(customTransactionId === undefined ? {} : { customTransactionId }),
    ...(failure === undefined ? {} : { failure }),
  };
};

export const readCheckoutOf = async (
  publicApiKey: string,
  checkoutContextId: string,
): Promise<CheckoutStatus> => {
  const response = await fetchWithRetry(
    subscriptionsApiUrl("checkout/status"),
    {
      method: "POST",
      headers: headers(publicApiKey),
      body: JSON.stringify({ checkoutId: checkoutContextId }),
    },
    { retries: 0 },
  );
  return readCheckoutStatus(await response.json());
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

export const RETURN_SESSION_FIELD = "returned";
export const RETURN_DATA_MAX_BYTES = 16 * 1024;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const readDataValue = (value: unknown): TeleportDataValue | undefined => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map(readDataValue);
    return items.every((item) => item !== undefined) ? items : undefined;
  }
  return isPlainObject(value) ? readData(value) : undefined;
};

const readData = (value: Record<string, unknown>): TeleportData | undefined => {
  const data: TeleportData = {};
  for (const [key, item] of Object.entries(value)) {
    const read = readDataValue(item);
    if (read === undefined) return undefined;
    Object.defineProperty(data, key, {
      value: read,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return data;
};

export const readPageReturn = (session: unknown): PageReturn | undefined => {
  const returned = field(session, RETURN_SESSION_FIELD);
  if (!isPlainObject(returned)) return undefined;
  const failure = readCheckoutFailure(returned.failure);
  const data = isPlainObject(returned.data) ? readData(returned.data) : undefined;
  const at = typeof returned.at === "number" ? returned.at : undefined;
  return {
    ...(failure === undefined ? {} : { failure }),
    ...(data === undefined ? {} : { data }),
    ...(at === undefined ? {} : { at }),
  };
};

export const readTeleportReturn = async (
  publicApiKey: string,
  teleportId: string,
): Promise<PageReturn | undefined> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetchWithRetry(
      subscriptionsApiUrl("checkout/teleport/session/read"),
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
  return readPageReturn(field(body, "session"));
};

export const saveTeleportReturn = async (
  publicApiKey: string,
  teleportId: string,
  query: Record<string, string>,
  returned: PageReturn,
): Promise<boolean> => {
  const response = await fetch(subscriptionsApiUrl("checkout/teleport/session"), {
    method: "POST",
    headers: headers(publicApiKey),
    keepalive: true,
    body: JSON.stringify({
      teleportId,
      session: { [SESSION_QUERY_FIELD]: query, [RETURN_SESSION_FIELD]: returned },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Saving the teleport return failed: ${response.status} ${await response.text()}`,
    );
  }
  return field(await response.json(), "saved") === true;
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
    if (reference !== undefined) warm.searchParams.set(TAPPED_PRODUCT_QUERY_KEY, reference);
    const request = new Image();
    request.crossOrigin = "anonymous";
    request.referrerPolicy = "no-referrer";
    request.src = warm.toString();
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
