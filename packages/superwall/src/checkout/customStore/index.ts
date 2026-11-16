import type { SuperwallProduct, SuperwallRuntimeSnapshot } from "@superwall/runtime";
import { checkoutContextOf } from "../api/body";
import { postCustomStoreSession } from "../api/customStore";
import {
  errorMessageOf,
  errorTagOf,
  readCustomStoreSession,
  type CustomStoreSession,
} from "../api/decode";
import { bareProductIdentifier } from "../products";
import type { PostCheckoutResolution } from "../types";

export const CUSTOM_STORE_REQUIRES_APP_USER_ID =
  "@open-revenue/subscriptions/errors/CustomStoreCheckoutRequiresAppUserId";

export const RETURN_KEY_PREFIX = "sw:custom-store-checkout:";

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
  const answer = await postCustomStoreSession(String(snapshot.device.publicApiKey ?? ""), body);
  if (answer.kind === "timeout") {
    throw new CustomStoreCheckoutError("The store's checkout took too long to start");
  }
  if (answer.kind === "unsent") {
    throw new CustomStoreCheckoutError("The checkout request could not be sent");
  }

  if (!answer.ok) {
    const tag = errorTagOf(answer.body);
    if (tag === CUSTOM_STORE_REQUIRES_APP_USER_ID) {
      throw new CustomStoreCheckoutError(
        "Custom store checkout refused this buyer's app_user_id: pass a real user id or none at all",
        tag,
      );
    }
    throw new CustomStoreCheckoutError(
      errorMessageOf(answer.body, `The checkout request answered ${answer.status}`),
      tag,
    );
  }

  const session = readCustomStoreSession(answer.body);
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
