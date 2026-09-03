export type SubscriptionsApiEnvironment = "local" | "staging" | "production";

export type SubscriptionsApiPath =
  | "checkout/session"
  | "checkout/session/confirm"
  | "checkout/session/complete"
  | "checkout/session/custom-metadata"
  | "checkout/discount"
  | "checkout/status";

const BASE_URL_BY_ENV: Record<SubscriptionsApiEnvironment, string> = {
  local: "http://localhost:3045/subscriptions-api/public/v1",
  staging: "https://subscriptions-api.superwall.dev/subscriptions-api/public/v1",
  production: "https://subscriptions-api.superwall.com/subscriptions-api/public/v1",
};

const buildUrl = (environment: SubscriptionsApiEnvironment, path: SubscriptionsApiPath) =>
  `${BASE_URL_BY_ENV[environment]}/${path}`;

const isEnvironment = (value: string): value is SubscriptionsApiEnvironment =>
  value === "local" || value === "staging" || value === "production";

const environmentOverride = (): SubscriptionsApiEnvironment | null => {
  if (typeof window === "undefined") return null;

  try {
    const fromQuery = new URLSearchParams(window.location.search).get("sw_subscriptions_env");
    if (fromQuery && isEnvironment(fromQuery)) return fromQuery;

    const fromStorage = window.localStorage?.getItem("sw_subscriptions_env");
    if (fromStorage && isEnvironment(fromStorage)) return fromStorage;
  } catch {}

  return null;
};

export const subscriptionsApiUrl = (path: SubscriptionsApiPath = "checkout/session"): string => {
  if (typeof window === "undefined") return buildUrl("production", path);

  const override = environmentOverride();
  if (override) return buildUrl(override, path);

  const hostname = window.location.hostname;
  if (hostname.includes("localhost") || hostname === "127.0.0.1") {
    return buildUrl("local", path);
  }
  if (
    hostname === "superwallapp.dev" ||
    hostname.endsWith(".superwallapp.dev") ||
    hostname === "superwallbeta.app" ||
    hostname.endsWith(".superwallbeta.app")
  ) {
    return buildUrl("staging", path);
  }

  return buildUrl("production", path);
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  { retries = 2, backoffMs = 300 }: { retries?: number; backoffMs?: number } = {},
): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      const body = await response.text().catch(() => "");
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error: ${response.status} ${body}`);
      }
      if (!RETRYABLE_STATUS.has(response.status)) {
        throw new Error(`Server error: ${response.status} ${body}`);
      }
      lastError = new Error(`Server error: ${response.status} ${body}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Client error:")) throw error;
      lastError = error;
    }

    if (attempt < retries) await delay(backoffMs * 2 ** attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
