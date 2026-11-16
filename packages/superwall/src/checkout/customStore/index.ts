import type { SuperwallProduct, SuperwallRuntimeSnapshot } from "@superwall/runtime";
import { checkoutContextOf } from "../api/body";
import {
  errorMessageOf,
  errorTagOf,
  field,
  readCustomStoreSession,
  type CustomStoreSession,
} from "../api/decode";
import { subscriptionsApiUrl } from "../api/url";
import { bareProductIdentifier } from "../products";
import type { PostCheckoutResolution } from "../types";

export const CUSTOM_STORE_REQUIRES_APP_USER_ID =
  "@open-revenue/subscriptions/errors/CustomStoreCheckoutRequiresAppUserId";

export const RETURN_KEY_PREFIX = "sw:custom-store-checkout:";

const SESSION_TIMEOUT_MS = 20_000;

export class CustomStoreCheckoutError extends Error {
  readonly tag: string | undefined;

  constructor(message: string, tag?: string) {
    super(message);
    this.name = "CustomStoreCheckoutError";
    this.tag = tag;
  }
}

export type CustomStoreBuyer = {
  appUserId?: string;
  email?: string;
  placementParams?: Record<string, string>;
};

export type WebCustomStoreSession = CustomStoreSession & { buyer: CustomStoreBuyer };

export type CustomStoreReturnRecord = {
  version: 1;
  checkoutContextId: string;
  paywallUrl: string;
  productReference: string;
  productIdentifier: string;
  customTransactionId: string;
  price?: { value: number; currency: string };
  resolution: PostCheckoutResolution;
  buyer?: CustomStoreBuyer;
  createdAt: number;
};

type CheckoutContext = ReturnType<typeof checkoutContextOf>;

const buyerOf = (context: CheckoutContext): CustomStoreBuyer => {
  const { appUserId, email } = context.identity;
  const placementParams = Object.fromEntries(
    Object.entries(context.placementParams.placementParams).map(([key, value]) => [
      key,
      String(value),
    ]),
  );
  return {
    ...(appUserId ? { appUserId } : {}),
    ...(email ? { email } : {}),
    ...(Object.keys(placementParams).length > 0 ? { placementParams } : {}),
  };
};

const timeoutSignal = (ms: number): AbortSignal => {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    ms,
  );
  return controller.signal;
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

export const customStoreSessionBody = (
  snapshot: SuperwallRuntimeSnapshot,
  product: SuperwallProduct,
) => {
  const productIdentifier = bareProductIdentifier(product.productId ?? "");
  const context = checkoutContextOf(snapshot, product, productIdentifier);
  return { productIdentifier, context, surface: "web" as const };
};

export const requestCustomStoreSession = async (
  snapshot: SuperwallRuntimeSnapshot,
  product: SuperwallProduct,
): Promise<WebCustomStoreSession> => {
  const body = customStoreSessionBody(snapshot, product);
  const response = await fetch(subscriptionsApiUrl("checkout/custom-store/session"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${String(snapshot.device.publicApiKey ?? "")}`,
    },
    body: JSON.stringify(body),
    signal: timeoutSignal(SESSION_TIMEOUT_MS),
  }).catch((error: unknown) => {
    if (field(error, "name") === "TimeoutError") {
      throw new CustomStoreCheckoutError("The store's checkout took too long to start");
    }
    throw new CustomStoreCheckoutError("The checkout request could not be sent");
  });
  const answer = await readJson(response);

  if (!response.ok) {
    const tag = errorTagOf(answer);
    if (tag === CUSTOM_STORE_REQUIRES_APP_USER_ID) {
      throw new CustomStoreCheckoutError(
        "Custom store checkout refused this buyer's app_user_id: pass a real user id or none at all",
        tag,
      );
    }
    throw new CustomStoreCheckoutError(
      errorMessageOf(answer, `The checkout request answered ${response.status}`),
      tag,
    );
  }

  const session = readCustomStoreSession(answer);
  if (!session) {
    throw new CustomStoreCheckoutError("Custom store checkout returned an invalid session");
  }
  return { ...session, buyer: buyerOf(body.context) };
};

export const saveCustomStoreReturnRecord = (record: CustomStoreReturnRecord): boolean => {
  try {
    window.sessionStorage.setItem(
      `${RETURN_KEY_PREFIX}${record.checkoutContextId}`,
      JSON.stringify(record),
    );
    return true;
  } catch (error) {
    console.warn("[superwall] Could not keep the custom store checkout's return details", error);
    return false;
  }
};

const checkoutsInFlight = new WeakSet<object>();

export const claimCustomStoreCheckout = (owner: object): (() => void) | undefined => {
  if (checkoutsInFlight.has(owner)) return undefined;
  checkoutsInFlight.add(owner);
  return () => {
    checkoutsInFlight.delete(owner);
  };
};
