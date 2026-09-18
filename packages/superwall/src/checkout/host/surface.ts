import type { PostPurchaseBehavior } from "../types";

type WebPaywallHost = { props?: { clientSurface?: unknown } };

/**
 * Whether the paywall is framed by the Web SDK on a merchant page. The web
 * host records it on itself, and the SDK also stamps `?client_surface=web-sdk`
 * on the iframe URL; paywall.js reads both, so read both.
 */
export const hostedInWebSdk = (): boolean => {
  const host = (window as typeof window & { webPaywallCtrl?: WebPaywallHost }).webPaywallCtrl;
  if (host?.props?.clientSurface === "web-sdk") return true;
  return new URLSearchParams(window.location.search).get("client_surface") === "web-sdk";
};

/**
 * Whether a completion under this behavior binds the entitlement to the
 * shopper server-side. `complete-webapp` refuses the others; an unknown
 * behavior means a session from before the field existed, so call rather
 * than drop one — the same rule paywall.js applies.
 */
export const bindsEntitlement = (behavior: PostPurchaseBehavior | undefined): boolean =>
  behavior === undefined || behavior === "GRANT_ACCESS" || behavior === "REDIRECT";
