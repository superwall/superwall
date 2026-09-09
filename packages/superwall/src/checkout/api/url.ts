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

const ENVIRONMENTS: readonly SubscriptionsApiEnvironment[] = ["local", "staging", "production"];

const environmentOf = (value: string | null | undefined): SubscriptionsApiEnvironment | undefined =>
  ENVIRONMENTS.find((environment) => environment === value);

const environmentOverride = (): SubscriptionsApiEnvironment | undefined => {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("sw_subscriptions_env");
    return (
      environmentOf(fromQuery) ??
      environmentOf(window.localStorage?.getItem("sw_subscriptions_env"))
    );
  } catch {
    return undefined;
  }
};

const STAGING_HOSTS = ["superwallapp.dev", "superwallbeta.app"];

export const subscriptionsApiUrl = (path: SubscriptionsApiPath = "checkout/session"): string => {
  if (typeof window === "undefined") return buildUrl("production", path);

  const override = environmentOverride();
  if (override) return buildUrl(override, path);

  const hostname = window.location.hostname;
  if (hostname.includes("localhost") || hostname === "127.0.0.1") {
    return buildUrl("local", path);
  }
  if (STAGING_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    return buildUrl("staging", path);
  }

  return buildUrl("production", path);
};
