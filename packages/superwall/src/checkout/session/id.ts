const PREFIX = "sw_checkout_";

const toBase64Url = (value: string): string =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromBase64Url = (value: string): string => atob(value.replace(/-/g, "+").replace(/_/g, "/"));

export const buildCheckoutSessionId = ({
  stripeCheckoutSessionId,
  environment,
}: {
  stripeCheckoutSessionId: string;
  environment: "test" | "live";
}): string =>
  `${PREFIX}${toBase64Url(
    JSON.stringify({ provider: "stripe", env: environment, stripeCheckoutSessionId }),
  )}`;

export const decodeCheckoutSessionId = (checkoutSessionId: string): string | null => {
  if (!checkoutSessionId.startsWith(PREFIX)) return null;
  try {
    const decoded: unknown = JSON.parse(fromBase64Url(checkoutSessionId.slice(PREFIX.length)));
    if (typeof decoded !== "object" || decoded === null) return null;
    if (!("stripeCheckoutSessionId" in decoded)) return null;
    const secret = decoded.stripeCheckoutSessionId;
    if (typeof secret !== "string" || secret.length === 0) return null;
    try {
      return decodeURIComponent(secret);
    } catch {
      return secret;
    }
  } catch {
    return null;
  }
};

export const stripeEnvironmentOf = (productIdentifier: string | undefined): "test" | "live" =>
  /^(stripe\|)?test:/.test(productIdentifier ?? "") ? "test" : "live";
