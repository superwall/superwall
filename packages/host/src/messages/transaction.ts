import type {
  TIncomingMessageFreeTrialStart,
  TIncomingMessageTransactionAbandon,
  TIncomingMessageTransactionComplete,
  TIncomingMessageTransactionFail,
  TIncomingMessageTransactionRestore,
  TIncomingMessageTransactionStart,
  TIncomingMessageTransactionTimeout,
} from "@superwall/protocol";
import type { HostProduct } from "../state";

const identified = (product: HostProduct) => ({
  product: product.reference,
  product_identifier: product.productId,
});

export const transactionStart = (product: HostProduct): TIncomingMessageTransactionStart => ({
  event_name: "transaction_start",
  ...identified(product),
});

export const transactionComplete = (product: HostProduct): TIncomingMessageTransactionComplete => ({
  event_name: "transaction_complete",
  ...identified(product),
});

export const transactionAbandon = (product: HostProduct): TIncomingMessageTransactionAbandon => ({
  event_name: "transaction_abandon",
  ...identified(product),
});

export const transactionFail = (product: HostProduct): TIncomingMessageTransactionFail => ({
  event_name: "transaction_fail",
  ...identified(product),
});

export const transactionTimeout = (product: HostProduct): TIncomingMessageTransactionTimeout => ({
  event_name: "transaction_timeout",
  ...identified(product),
});

export const transactionRestore = (): TIncomingMessageTransactionRestore => ({
  event_name: "transaction_restore",
});

export const freeTrialStart = (
  product: HostProduct,
  trialEndDate: number,
): TIncomingMessageFreeTrialStart => ({
  event_name: "freeTrial_start",
  product_identifier: product.productId,
  trial_end_date: trialEndDate,
});
