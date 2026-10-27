import { field } from "../api/decode";

export type TeleportBoot = {
  id: string;
  route: string;
  returnUrl?: string;
  appLinkUrl?: string;
  productReference?: string;
  hasIntroductoryOffer?: boolean;
  email?: string;
  shared: boolean;
  query: Record<string, string>;
  loadSession: boolean;
};

export const NAV_QUERY_KEY = "sw_nav";
export const SESSION_QUERY_FIELD = "query";
export const TAPPED_PRODUCT_FRAGMENT_KEY = "ref";
export const QUERY_FRAGMENT_KEY = "s";
export const INTRODUCTORY_OFFER_FRAGMENT_KEY = "t";
const REFERENCE_NAME = /^[\w.-]{1,191}$/;

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const navigable = (value: unknown): string | undefined => {
  const text = textOf(value);
  if (text === undefined) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "javascript:" || url.protocol === "data:" ? undefined : text;
  } catch {
    return undefined;
  }
};

export const sessionQueryOf = (session: unknown): Record<string, string> => {
  const query = field(session, SESSION_QUERY_FIELD);
  if (typeof query !== "object" || query === null) return {};
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && key !== NAV_QUERY_KEY) entries[key] = value;
  }
  return entries;
};

const fragment = (): URLSearchParams => new URLSearchParams(window.location.hash.replace(/^#/, ""));

const tappedProduct = (): string | undefined => {
  const reference = fragment().get(TAPPED_PRODUCT_FRAGMENT_KEY);
  return reference !== null && REFERENCE_NAME.test(reference) ? reference : undefined;
};

export const encodeQueryPatch = (query: Record<string, string>): string => {
  const bytes = new TextEncoder().encode(JSON.stringify({ [SESSION_QUERY_FIELD]: query }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

export const introductoryOfferFromFragment = (): boolean | undefined => {
  const value = fragment().get(INTRODUCTORY_OFFER_FRAGMENT_KEY);
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
};

const fragmentQuery = (): Record<string, string> => {
  const encoded = fragment().get(QUERY_FRAGMENT_KEY);
  if (encoded === null) return {};
  try {
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return sessionQueryOf(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return {};
  }
};

export const readTeleportBoot = (): TeleportBoot | undefined => {
  if (typeof window === "undefined") return undefined;
  const value: unknown = (window as typeof window & { __SW_TELEPORT__?: unknown }).__SW_TELEPORT__;
  const id = textOf(field(value, "id"));
  const route = textOf(field(value, "route"));
  if (id === undefined || route === undefined) return undefined;
  const returnUrl = navigable(field(value, "returnUrl"));
  const appLinkUrl = navigable(field(value, "appLinkUrl"));
  const productReference = tappedProduct() ?? textOf(field(value, "productReference"));
  const booted = field(value, "hasIntroductoryOffer");
  const hasIntroductoryOffer =
    introductoryOfferFromFragment() ?? (typeof booted === "boolean" ? booted : undefined);
  const email = textOf(field(value, "email"));
  return {
    id,
    route,
    ...(returnUrl === undefined ? {} : { returnUrl }),
    ...(appLinkUrl === undefined ? {} : { appLinkUrl }),
    ...(productReference === undefined ? {} : { productReference }),
    ...(hasIntroductoryOffer === undefined ? {} : { hasIntroductoryOffer }),
    ...(email === undefined ? {} : { email }),
    shared: field(value, "shared") === true,
    query: { ...sessionQueryOf(field(value, "session")), ...fragmentQuery() },
    loadSession: field(value, "loadSession") === true && field(value, "session") === undefined,
  };
};

export const seedTeleportUrl = (routes: readonly string[]): void => {
  const boot = readTeleportBoot();
  if (boot === undefined || !routes.includes(boot.route)) return;
  const params = new URLSearchParams(window.location.search);
  if (params.has(NAV_QUERY_KEY)) return;
  for (const [key, value] of Object.entries(boot.query)) {
    if (!params.has(key)) params.set(key, value);
  }
  params.set(NAV_QUERY_KEY, boot.route);
  try {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${params.toString()}${window.location.hash}`,
    );
  } catch {}
};
