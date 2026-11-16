export const CHECKOUT_FAILURE_REASONS = [
  "card_declined",
  "insufficient_funds",
  "expired_card",
  "incorrect_card_details",
  "authentication_failed",
  "card_not_supported",
  "limit_exceeded",
  "fraud_suspected",
  "processing_error",
  "unknown",
] as const;

/**
 * Why a web checkout payment failed, in superwall's own words: the same
 * reasons whichever store or payment method took the payment.
 */
export type CheckoutFailureReason = (typeof CHECKOUT_FAILURE_REASONS)[number];

/** A web checkout payment that failed, and why. */
export type CheckoutFailure = {
  /** Why it failed. `unknown` when the store gave no reason superwall knows. */
  reason: CheckoutFailureReason;
  /** The store that refused the payment. */
  store: "stripe";
  /** The store's own error code, such as Stripe's `card_declined`. Absent when the store sent none. */
  code?: string;
  /** The issuer's decline code, such as Stripe's `insufficient_funds`. Absent when the store sent none. */
  declineCode?: string;
  /** The store's message for the customer. Absent when the store sent none. */
  message?: string;
};

const BY_DECLINE_CODE: Readonly<Record<string, CheckoutFailureReason>> = {
  insufficient_funds: "insufficient_funds",
  expired_card: "expired_card",
  incorrect_cvc: "incorrect_card_details",
  invalid_cvc: "incorrect_card_details",
  incorrect_number: "incorrect_card_details",
  invalid_number: "incorrect_card_details",
  invalid_expiry_month: "incorrect_card_details",
  invalid_expiry_year: "incorrect_card_details",
  incorrect_zip: "incorrect_card_details",
  incorrect_pin: "incorrect_card_details",
  invalid_pin: "incorrect_card_details",
  authentication_required: "authentication_failed",
  card_not_supported: "card_not_supported",
  currency_not_supported: "card_not_supported",
  transaction_not_allowed: "card_not_supported",
  not_permitted: "card_not_supported",
  invalid_account: "card_not_supported",
  card_velocity_exceeded: "limit_exceeded",
  withdrawal_count_limit_exceeded: "limit_exceeded",
  pin_try_exceeded: "limit_exceeded",
  fraudulent: "fraud_suspected",
  lost_card: "fraud_suspected",
  stolen_card: "fraud_suspected",
  pickup_card: "fraud_suspected",
  restricted_card: "fraud_suspected",
  merchant_blacklist: "fraud_suspected",
  security_violation: "fraud_suspected",
  processing_error: "processing_error",
  issuer_not_available: "processing_error",
  try_again_later: "processing_error",
  reenter_transaction: "processing_error",
  generic_decline: "card_declined",
  do_not_honor: "card_declined",
  call_issuer: "card_declined",
  no_action_taken: "card_declined",
  revocation_of_authorization: "card_declined",
  revocation_of_all_authorizations: "card_declined",
  stop_payment_order: "card_declined",
  card_declined: "card_declined",
};

const BY_CODE: Readonly<Record<string, CheckoutFailureReason>> = {
  card_declined: "card_declined",
  expired_card: "expired_card",
  incorrect_cvc: "incorrect_card_details",
  invalid_cvc: "incorrect_card_details",
  incorrect_number: "incorrect_card_details",
  invalid_number: "incorrect_card_details",
  invalid_expiry_month: "incorrect_card_details",
  invalid_expiry_year: "incorrect_card_details",
  invalid_expiry_month_past: "expired_card",
  invalid_expiry_year_past: "expired_card",
  incorrect_zip: "incorrect_card_details",
  incomplete_number: "incorrect_card_details",
  incomplete_cvc: "incorrect_card_details",
  incomplete_expiry: "incorrect_card_details",
  incomplete_zip: "incorrect_card_details",
  payment_intent_authentication_failure: "authentication_failed",
  setup_intent_authentication_failure: "authentication_failed",
  card_decline_rate_limit_exceeded: "limit_exceeded",
  processing_error: "processing_error",
  payment_method_not_available: "card_not_supported",
  payment_method_unsupported_type: "card_not_supported",
};

const lookup = (
  table: Readonly<Record<string, CheckoutFailureReason>>,
  key: string | undefined,
): CheckoutFailureReason | undefined =>
  key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;

export const classifyStripeFailure = (
  code: string | undefined,
  declineCode: string | undefined,
): CheckoutFailureReason =>
  lookup(BY_DECLINE_CODE, declineCode) ?? lookup(BY_CODE, code) ?? "unknown";

export const stripeFailure = (fields: {
  code?: string;
  declineCode?: string;
  message?: string;
}): CheckoutFailure => ({
  reason: classifyStripeFailure(fields.code, fields.declineCode),
  store: "stripe",
  ...(fields.code ? { code: fields.code } : {}),
  ...(fields.declineCode ? { declineCode: fields.declineCode } : {}),
  ...(fields.message ? { message: fields.message } : {}),
});
