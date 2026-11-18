import { useMemo } from "react";
import { PurchaseButton, useCheckout } from "superwall/checkout";
import type { CheckoutAmounts } from "superwall/checkout";
import {
  ExpressCheckoutElement,
  LinkAuthenticationElement,
  PaymentElement,
  StripeCheckout,
} from "superwall/checkout/stripe";
import type { StripeCheckoutOptions } from "superwall/checkout/stripe";
import { useColorScheme, useHaptics, useTranslation } from "superwall/hooks";

type Props = {
  product: "trial" | "monthly";
  onCompleted: () => void;
};

/**
 * Stripe's fields in this paywall's design system: the same corner, accent,
 * typeface and light or dark scheme as the rest of the page. Kept stable
 * with `useMemo`, since a new object re-renders every element.
 */
const useStripeAppearance = (): StripeCheckoutOptions => {
  const scheme = useColorScheme();
  return useMemo(
    () => ({
      fonts: [
        { cssSrc: "https://fonts.googleapis.com/css2?family=Manrope:wght@400..600&display=swap" },
      ],
      appearance: {
        theme: scheme === "dark" ? "night" : "stripe",
        variables: {
          colorPrimary: "#46d7d4",
          fontFamily: "Manrope, system-ui, sans-serif",
          borderRadius: "3px",
          ...(scheme === "dark"
            ? { colorBackground: "#232220", colorText: "#fdfef6" }
            : { colorBackground: "#ffffff", colorText: "#0c0b0a" }),
        },
      },
    }),
    [scheme],
  );
};

/** Minor units (cents) to a price in the shopper's language. */
const formatAmount = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);

const intervalOf = ({ interval, intervalCount }: CheckoutAmounts) =>
  intervalCount === 1 ? interval : `${intervalCount} ${interval}s`;

/**
 * Stripe's wallet buttons, then the email and card form. A card payment
 * needs the shopper's email for their receipt and the billing portal, so
 * the email field comes first; it is filled in when the paywall already
 * knows the email. Where the paywall can't take payment, such as inside the
 * iOS app, they render nothing, so the divider between them goes too.
 */
const Fields = () => {
  const { t } = useTranslation();
  const { status } = useCheckout();
  if (status === "unavailable") return null;
  return (
    <div className="form">
      <ExpressCheckoutElement
        options={{ buttonHeight: 52, buttonType: { applePay: "subscribe" } }}
      />
      <p className="divider">{t("form.or")}</p>
      <LinkAuthenticationElement />
      <PaymentElement options={{ layout: "tabs" }} />
    </div>
  );
};

/**
 * Everything inside `<StripeCheckout>` reads the form's state from
 * `useCheckout()`, which reads the same for any store, so this summary and
 * its button would work unchanged in another store's form.
 */
const Summary = () => {
  const { t } = useTranslation();
  const { status, amounts, failure, message } = useCheckout();

  return (
    <>
      {amounts ? (
        <div className="due">
          <span>{t("form.dueToday")}</span>
          <span>
            {formatAmount(amounts.dueNow, amounts.currency)}
            {" · "}
            {t("form.renews", {
              price: formatAmount(amounts.recurring, amounts.currency),
              interval: intervalOf(amounts),
            })}
          </span>
        </div>
      ) : null}
      {failure ? (
        <p className="notice notice--error" role="status">
          {t("purchase.failed", { reason: failure.message ?? t("purchase.declined") })}
        </p>
      ) : null}
      {status === "unavailable" ? (
        <p className="notice" role="status">
          {t("purchase.unavailable", { message: message ?? "" })}
        </p>
      ) : null}
      <PurchaseButton className="button button--primary">
        {status === "paying"
          ? t("purchase.paying")
          : amounts?.dueNow === 0
            ? t("purchase.startTrial")
            : t("purchase.subscribe")}
      </PurchaseButton>
    </>
  );
};

/**
 * A wallet row, a card form and a purchase button for one plan. superwall
 * prices the form from the product, takes the payment, runs 3D Secure and
 * the free trial, and completes the purchase; the callbacks report it.
 */
export function CheckoutForm({ product, onCompleted }: Props) {
  const haptics = useHaptics();
  const options = useStripeAppearance();

  return (
    <StripeCheckout
      product={product}
      options={options}
      onComplete={() => {
        haptics.success();
        onCompleted();
      }}
      onFailure={(failure) => console.info("onFailure", failure)}
      onAbandon={() => console.info("onAbandon")}
    >
      <Fields />
      <div className="actions">
        <Summary />
      </div>
    </StripeCheckout>
  );
}
