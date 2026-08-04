/** How a purchase completes, as declared by `checkout` in the paywall config. */
export type CheckoutMode = "sheet" | "external" | "applePay";

/**
 * Apple Pay warms its own sessions so a sheet purchase and an Apple Pay
 * purchase never reuse a session created for the other surface.
 */
export type CheckoutSessionCacheScope = "default" | "apple-pay";

export type EmbeddedCheckoutSession = {
  directive: "embedded";
  checkoutSessionId: string;
  clientSecret: string;
  publishableKey: string;
  checkoutContextId: string;
  referenceName: string;
  wasPrefetched?: boolean;
};

export type RedirectCheckoutSession = {
  directive: "redirect";
  checkoutSessionId: string;
  checkoutUrl: string;
  checkoutContextId: string;
  referenceName: string;
  wasPrefetched?: boolean;
};

export type CheckoutSessionResult = EmbeddedCheckoutSession | RedirectCheckoutSession;

export type AppliedDiscount = {
  code: string;
  promotionCodeId: string;
  couponId: string;
  name?: string | null;
  percentOff?: number | null;
  amountOff?: number | null;
  currency?: string | null;
  duration?: "forever" | "once" | "repeating";
  durationInMonths?: number | null;
  firstTimeTransactionOnly?: boolean;
};

export type DiscountedProductPrice = {
  productIdentifier: string;
  applies: boolean;
  originalAmount: number;
  discountedAmount: number;
  currency: string;
  interval?: "day" | "week" | "month" | "year";
  intervalCount?: number;
  productName?: string;
};

export type DiscountValidationResult =
  | { valid: true; discount: AppliedDiscount; products: DiscountedProductPrice[] }
  | { valid: false; reason: string };

export type SessionData = EmbeddedCheckoutSession & {
  deviceModel?: string;
};

export interface PresentationContext {
  isFullscreen: boolean;
  deviceModel: string;
}

export interface CheckoutState {
  isOpen: boolean;
  activeSession: SessionData | null;
  pooledSessions: Map<string, SessionData>;
  poolOrder: string[];
  readyState: Map<string, boolean>;
  isProcessing: boolean;
  error: Error | null;
  presentation: PresentationContext;
}

export interface CheckoutActions {
  openSheet: (session: SessionData) => void;
  closeSheet: () => void;
  markSessionReady: (clientSecret: string) => void;
  addOrUpdateSession: (session: SessionData) => void;
  touchSession: (clientSecret: string) => void;
  removeSession: (clientSecret: string) => void;
  setProcessing: (isProcessing: boolean) => void;
  setError: (error: Error | null) => void;
}

export type CheckoutAction =
  | { type: "OPEN_SHEET"; payload: SessionData }
  | { type: "CLOSE_SHEET" }
  | { type: "MARK_READY"; payload: string }
  | { type: "ADD_SESSION"; payload: SessionData }
  | { type: "TOUCH_SESSION"; payload: string }
  | { type: "REMOVE_SESSION"; payload: string }
  | { type: "CLEAR_ALL_SESSIONS" }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_ERROR"; payload: Error | null }
  | { type: "SET_DEVICE_MODEL"; payload: string };

export type CheckoutEventType =
  | "SESSION_CREATED"
  | "SHEET_OPEN"
  | "SHEET_CLOSE"
  | "EMBEDDED_READY"
  | "CHECKOUT_SUBMITTED"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_ERROR"
  | "SESSION_INVALIDATED";

export interface CheckoutEventPayload {
  SESSION_CREATED: SessionData;
  SHEET_OPEN: { session: SessionData };
  SHEET_CLOSE: void;
  EMBEDDED_READY: { clientSecret: string };
  CHECKOUT_SUBMITTED: { session: SessionData };
  PAYMENT_SUCCESS: { session: SessionData };
  PAYMENT_ERROR: { error: Error; session: SessionData };
  SESSION_INVALIDATED: { reason?: string };
}
