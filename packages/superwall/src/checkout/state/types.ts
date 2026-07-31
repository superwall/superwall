export interface AppliedDiscount {
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
}

export interface SubscriptionDetails {
  amount: number;
  amountDueNow?: number;
  currency: string;
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
  trialPeriodDays?: number;
  productName?: string;
  discountedAmount?: number;
  discount?: AppliedDiscount;
}

export interface ApplicationDetails {
  iconUrl?: string | null;
}

export interface SessionData {
  directive: "embedded";
  clientSecret: string;
  publishableKey: string;
  checkoutContextId: string;
  checkoutSessionId: string | null;
  referenceName: string;
  subscriptionDetails?: SubscriptionDetails;
  paymentMethodTypes?: string[];
  intentType?: "SetupIntent" | "PaymentIntent";
  publicApiKey?: string;
  application?: ApplicationDetails;
  email?: string;
  deviceModel?: string;
  stripeAccountCountryCode?: string;
  managementUrl?: string;
  stripeCustomerId?: string;
  customMetadata?: Record<string, string>;
  wasPrefetched?: boolean;
}

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
