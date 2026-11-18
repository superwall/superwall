import * as React from "react";
import { Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Stripe, StripeElements, StripeElementsOptionsMode } from "@stripe/stripe-js";
import type {
  SuperwallPostPurchase,
  SuperwallProduct,
  SuperwallRuntimeSnapshot,
} from "@superwall/runtime";
import { useSuperwallSession } from "../../provider/context";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";
import { listenToPurchases } from "../../hooks/purchaseListener";
import type { PurchaseCallbacks } from "../../hooks/usePurchase";
import type { ProductReference } from "../../hooks";
import { hostOf } from "../../host";
import { readStripeError } from "../api/decode";
import type { PurchaseAttempt } from "../events";
import { CheckoutFailureError, type CheckoutFailure } from "../failure";
import { elementsFor, prefetchSession, purchaseWithElements, sessionsFor } from "../flow";
import { checkoutModeFor } from "../host/sdk";
import type { ElementsCheckoutSession } from "../types";
import {
  checkoutErrorOf,
  type CheckoutError,
  type CollectedPayment,
  type ElementsQuote,
} from "./index";
import {
  CheckoutContext,
  type CheckoutAmounts,
  type CheckoutSubmitResult,
  type CheckoutUnavailableReason,
  type UseCheckoutResult,
} from "../form/useCheckout";
import { ExpressContext, type ExpressHandlers } from "./ExpressCheckoutElement";
import { EmailContext } from "./LinkAuthenticationElement";

/**
 * Stripe's options for the form's elements, such as `appearance`, `fonts`,
 * `locale` and `paymentMethodTypes`. `<StripeCheckout>` sets the amount, currency
 * and mode from the product. `paymentMethodTypes` defaults to
 * `["card", "link"]`, which covers cards, Apple Pay, Google Pay and Link.
 */
export type StripeCheckoutOptions = Omit<
  StripeElementsOptionsMode,
  "mode" | "amount" | "currency" | "paymentMethodCreation" | "setupFutureUsage"
>;

export type StripeCheckoutProps<TProduct extends SuperwallProduct = SuperwallProduct> =
  PurchaseCallbacks<TProduct> & {
    /** The Stripe product the form sells, by reference or as a product. */
    product: ProductReference | TProduct;
    /** Stripe's options for the form's elements. Defaults to Stripe's own. */
    options?: StripeCheckoutOptions;
    /** What happens after the purchase, as for `purchase()`. Defaults to the paywall's config. */
    postPurchase?: SuperwallPostPurchase;
    /** Metadata to set on the Stripe subscription. Defaults to none. */
    stripeMetadata?: Readonly<Record<string, string>>;
    /** The form: Stripe's elements from `superwall/checkout/stripe`, a `<PurchaseButton>`, your own UI. */
    children?: React.ReactNode;
  };

const MESSAGES: Record<CheckoutUnavailableReason, string> = {
  unsupported_host:
    "This host never takes payment in the paywall: inside the iOS app, in Studio, or in an SDK older than 4.10.8.",
  external_checkout:
    "The config's `checkout` sends shoppers to Superwall's hosted checkout. Set it to \"elements\".",
  missing_public_api_key: "The host supplied no public API key.",
  unknown_product: "The paywall has no product with this reference.",
  unsupported_product: "The product is not sold by Stripe. Buy it with usePurchase().purchase().",
  session_failed: "Fetching the product's checkout failed.",
  session_unsupported: "The backend can't take this product's payment in a form.",
  store_load_failed: "Stripe.js did not load.",
};

const DEFAULT_PAYMENT_METHOD_TYPES = ["card", "link"];

const subscribeToNothing = () => () => {};

const NOT_PREPARED: ElementsQuote = { status: "unavailable", reason: "not_prepared" };

type ReadyQuote = Extract<ElementsQuote, { status: "ready" }>;

const storedReasonOf = (stored: ElementsQuote): CheckoutUnavailableReason | undefined => {
  if (stored.status !== "unavailable" || stored.reason === "not_prepared") return undefined;
  return stored.reason === "stripe_load_failed" ? "store_load_failed" : stored.reason;
};

const blockedReason = (
  snapshot: SuperwallRuntimeSnapshot,
  host: string,
  isStripeProduct: boolean,
  reference: string,
): CheckoutUnavailableReason | undefined => {
  if (host === "studio") return "unsupported_host";
  if (checkoutModeFor(snapshot, "elements") !== "elements") {
    const asElements = { ...snapshot, config: { ...snapshot.config, checkout: "elements" } };
    return checkoutModeFor(asElements as SuperwallRuntimeSnapshot, "elements") === "elements"
      ? "external_checkout"
      : "unsupported_host";
  }
  if (!snapshot.device.publicApiKey) return "missing_public_api_key";
  if (snapshot.productsByReference[reference] === undefined) return "unknown_product";
  if (!isStripeProduct) return "unsupported_product";
  return undefined;
};

export const amountsOf = (quote: ElementsCheckoutSession): CheckoutAmounts => {
  const details = quote.subscriptionDetails;
  const recurring = details.discountedAmount ?? details.amount;
  const dueNow = details.amountDueNow ?? (quote.intentType === "SetupIntent" ? 0 : recurring);
  return {
    currency: details.currency.toLowerCase(),
    dueNow,
    recurring,
    interval: details.interval,
    intervalCount: details.intervalCount,
    ...(details.trialPeriodDays ? { trialDays: details.trialPeriodDays } : {}),
    ...(details.discount ? { discount: details.discount } : {}),
  };
};

export const intentTypeOf = (quote: ElementsCheckoutSession): "SetupIntent" | "PaymentIntent" =>
  quote.intentType ?? (amountsOf(quote).dueNow === 0 ? "SetupIntent" : "PaymentIntent");

type CheckoutPriceFields = {
  mode?: unknown;
  amount?: unknown;
  currency?: unknown;
  paymentMethodCreation?: unknown;
  setupFutureUsage?: unknown;
};

export const elementsOptionsOf = (
  quote: ElementsCheckoutSession,
  options: StripeCheckoutOptions = {},
): StripeElementsOptionsMode => {
  const { currency, dueNow } = amountsOf(quote);
  const {
    mode: _mode,
    amount: _amount,
    currency: _currency,
    paymentMethodCreation: _creation,
    setupFutureUsage: _usage,
    ...stripeOptions
  } = options as CheckoutPriceFields & StripeCheckoutOptions;
  const base = {
    paymentMethodTypes: DEFAULT_PAYMENT_METHOD_TYPES,
    ...stripeOptions,
    currency,
    paymentMethodCreation: "manual" as const,
  };
  return intentTypeOf(quote) === "SetupIntent"
    ? { ...base, mode: "setup", setupFutureUsage: "off_session" }
    : { ...base, mode: "subscription", amount: dueNow };
};

const collectWith =
  (stripe: Stripe, elements: StripeElements) => async (): Promise<CollectedPayment> => {
    const result = await stripe.createPaymentMethod({ elements });
    if (result.error) {
      throw new CheckoutFailureError(readStripeError(result.error), "Collecting payment failed");
    }
    const email = result.paymentMethod.billing_details?.email;
    return { paymentMethodId: result.paymentMethod.id, ...(email ? { email } : {}) };
  };

type Pending = {
  resolve: (payment: CollectedPayment | null) => void;
  reject: (error: unknown) => void;
  outcome: Promise<CheckoutSubmitResult>;
};

const deferredPayment = () => {
  const settle: Partial<Pick<Pending, "resolve" | "reject">> = {};
  const promise = new Promise<CollectedPayment | null>((resolve, reject) => {
    settle.resolve = resolve;
    settle.reject = reject;
  });
  return { promise, resolve: settle.resolve!, reject: settle.reject! };
};

type FormProps = {
  reference: string;
  product: SuperwallProduct | undefined;
  blocked: CheckoutUnavailableReason | undefined;
  stored: ElementsQuote;
  callbacks: React.RefObject<StripeCheckoutProps>;
  children?: React.ReactNode;
};

const EMAIL_REQUIRED: CheckoutError = {
  name: "email_required",
  message: "Enter an email address. Render LinkAuthenticationElement to collect one.",
};

const knownEmailOf = (snapshot: SuperwallRuntimeSnapshot): string | undefined => {
  const email = snapshot.user.email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
};

const Form = ({ reference, product, blocked, stored, callbacks, children }: FormProps) => {
  const session = useSuperwallSession();
  const snapshot = useSuperwallSnapshot();
  const knownEmail = knownEmailOf(snapshot);
  const entered = React.useRef<string | undefined>(undefined);
  const emailHandlers = React.useMemo(
    () => ({
      knownEmail,
      setEmail: (email: string | undefined) => {
        entered.current = email || undefined;
      },
    }),
    [knownEmail],
  );
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = React.useState(false);
  const [failure, setFailure] = React.useState<CheckoutFailure | undefined>(undefined);
  const busy = React.useRef(false);
  const express = React.useRef<Pending | undefined>(undefined);

  const ready = blocked === undefined && stored.status === "ready";
  const canSubmit = ready && !paying && stripe !== null && elements !== null;
  const live = React.useRef({
    canSubmit,
    stripe,
    elements,
    product,
    ready,
    blocked,
    stored,
    knownEmail,
  });
  live.current = { canSubmit, stripe, elements, product, ready, blocked, stored, knownEmail };
  const emailOf = (payment: CollectedPayment, wallet?: string | null): string | undefined =>
    payment.email || wallet || entered.current || live.current.knownEmail;

  const unavailable = (): CheckoutSubmitResult => {
    const now = live.current;
    const reason =
      now.blocked ?? storedReasonOf(now.stored) ?? (busy.current ? "paying" : "preparing");
    return { status: "unavailable", reason, ...(now.product ? { product: now.product } : {}) };
  };

  const run = (collect: () => Promise<CollectedPayment | null>): Promise<CheckoutSubmitResult> => {
    const { postPurchase, stripeMetadata } = callbacks.current;
    const attempt: PurchaseAttempt = {};
    const stop = listenToPurchases(session, () => callbacks.current, attempt);
    busy.current = true;
    setPaying(true);
    setFailure(undefined);
    return purchaseWithElements(
      session,
      reference,
      collect,
      {
        ...(postPurchase === undefined ? {} : { postPurchase }),
        ...(stripeMetadata === undefined ? {} : { stripeMetadata }),
      },
      attempt,
    )
      .then((outcome): CheckoutSubmitResult => {
        if (outcome.status === "failed") setFailure(outcome.failure);
        return { ...outcome, product: live.current.product as SuperwallProduct };
      })
      .finally(() => {
        stop();
        busy.current = false;
        express.current = undefined;
        setPaying(false);
      });
  };

  const submit = async (): Promise<CheckoutSubmitResult> => {
    const { canSubmit: can, stripe: client, elements: form, product: sold } = live.current;
    if (!can || busy.current || client === null || form === null) {
      return unavailable();
    }
    busy.current = true;
    const incomplete = (error: CheckoutError): CheckoutSubmitResult => {
      busy.current = false;
      return { status: "incomplete", product: sold as SuperwallProduct, error };
    };
    let checked: Awaited<ReturnType<StripeElements["submit"]>>;
    try {
      checked = await form.submit();
    } catch (error) {
      return incomplete(checkoutErrorOf(error));
    }
    if (checked.error) {
      return incomplete({ name: checked.error.type, message: checked.error.message ?? "" });
    }
    let payment: CollectedPayment;
    try {
      payment = await collectWith(client, form)();
    } catch (error) {
      return run(() => Promise.reject(error));
    }
    const email = emailOf(payment);
    if (email === undefined) return incomplete(EMAIL_REQUIRED);
    return run(() => Promise.resolve({ ...payment, email }));
  };

  const handlers: ExpressHandlers = {
    onClick: (event) => {
      if (!live.current.canSubmit || busy.current) {
        event.reject();
        return;
      }
      event.resolve({ emailRequired: true });
      const { promise, resolve, reject } = deferredPayment();
      const outcome = run(() => promise);
      express.current = { resolve, reject, outcome };
    },
    onConfirm: async (event) => {
      const pending = express.current;
      const { stripe: client, elements: form } = live.current;
      if (pending === undefined || client === null || form === null) {
        event.paymentFailed({ reason: "fail" });
        return;
      }
      try {
        const checked = await form.submit();
        if (checked.error) {
          throw new CheckoutFailureError(
            readStripeError(checked.error),
            "Collecting payment failed",
          );
        }
        const payment = await collectWith(client, form)();
        const email = emailOf(payment, event.billingDetails?.email);
        pending.resolve(email === undefined ? payment : { ...payment, email });
      } catch (error) {
        pending.reject(error);
      }
      const result = await pending.outcome;
      if (result.status === "failed") event.paymentFailed({ reason: "fail" });
    },
    onCancel: () => {
      express.current?.resolve(null);
    },
  };

  const quote = stored.status === "ready" ? stored.quote : undefined;
  const checkout: UseCheckoutResult = {
    status:
      blocked !== undefined || storedReasonOf(stored) !== undefined
        ? "unavailable"
        : paying
          ? "paying"
          : canSubmit
            ? "ready"
            : "preparing",
    canSubmit,
    submit,
    ...(product ? { product } : {}),
    ...(quote ? { amounts: amountsOf(quote) } : {}),
    ...(failure ? { failure } : {}),
  };
  const reason = blocked ?? storedReasonOf(stored);
  if (reason !== undefined) {
    checkout.reason = reason;
    checkout.message = MESSAGES[reason];
    if (blocked === undefined && stored.status === "unavailable" && stored.error) {
      checkout.error = stored.error;
    }
  }

  return (
    <CheckoutContext.Provider value={checkout}>
      <ExpressContext.Provider value={handlers}>
        <EmailContext.Provider value={emailHandlers}>{children}</EmailContext.Provider>
      </ExpressContext.Provider>
    </CheckoutContext.Provider>
  );
};

/**
 * A checkout form for one Stripe product, built from Stripe's own elements:
 * superwall prices it, takes the payment, handles 3D Secure and free trials,
 * and completes the purchase exactly as Apple Pay and the sheet do. Put
 * `PaymentElement` and `ExpressCheckoutElement` from
 * `superwall/checkout/stripe` and `<PurchaseButton>` from `superwall/checkout`
 * inside it, with any options Stripe gives them.
 *
 * The form renders at once from the product's price; nothing is charged or
 * created in Stripe until the shopper pays. It needs the config's `checkout`
 * to be `"elements"`, which also loads the price as the paywall opens.
 * Where the paywall can't take payment, such as inside the iOS app,
 * `useCheckout().status` is `"unavailable"` and Stripe's elements render
 * nothing.
 *
 * The callbacks fire for this form's purchases only, beside any passed to
 * `usePurchase`, which also fire for them.
 *
 * ```tsx
 * <StripeCheckout product="annual" onComplete={() => router.push("welcome")}>
 *   <ExpressCheckoutElement />
 *   <PaymentElement options={{ layout: "accordion" }} />
 *   <PurchaseButton>Start my free trial</PurchaseButton>
 * </StripeCheckout>
 * ```
 */
export const StripeCheckout = <TProduct extends SuperwallProduct = SuperwallProduct>(
  props: StripeCheckoutProps<TProduct>,
) => {
  const { product: input, options, children } = props;
  const session = useSuperwallSession();
  const snapshot = useSuperwallSnapshot();
  const host = React.useMemo(() => hostOf(), []);
  const reference = typeof input === "string" ? input : input.reference;
  const product = snapshot.productsByReference[reference];
  const blocked = blockedReason(
    snapshot,
    host,
    sessionsFor(session).isStripeProduct(reference),
    reference,
  );
  const store = blocked === undefined ? elementsFor(session) : undefined;
  const read = React.useCallback(
    () => (store ? store.quoteOf(reference) : NOT_PREPARED),
    [store, reference],
  );
  const stored = React.useSyncExternalStore(store?.subscribe ?? subscribeToNothing, read, read);

  React.useEffect(() => {
    if (stored.status === "unavailable" && stored.reason === "not_prepared" && store) {
      void prefetchSession(session, reference, "elements");
    }
  }, [stored, store, session, reference]);

  const callbacks = React.useRef(props as StripeCheckoutProps);
  callbacks.current = props as StripeCheckoutProps;

  const lastReady = React.useRef<ReadyQuote | undefined>(undefined);
  if (stored.status === "ready") lastReady.current = stored;
  const shown = blocked === undefined ? lastReady.current : undefined;
  const elementsOptions = React.useMemo(
    () => (shown ? elementsOptionsOf(shown.quote, options) : undefined),
    [shown, options],
  );

  return (
    <Elements
      key={shown?.quote.publishableKey ?? "pending"}
      stripe={shown?.stripe ?? null}
      {...(elementsOptions ? { options: elementsOptions } : {})}
    >
      <Form
        reference={reference}
        product={product}
        blocked={blocked}
        stored={stored}
        callbacks={callbacks}
      >
        {children}
      </Form>
    </Elements>
  );
};
