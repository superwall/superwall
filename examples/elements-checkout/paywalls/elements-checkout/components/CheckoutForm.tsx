import { useMemo, useState } from "react";
import { PurchaseButton, useCheckout } from "superwall/checkout";
import type { CheckoutAmounts } from "superwall/checkout";
import {
  AddressElement,
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  ExpressCheckoutElement,
  LinkAuthenticationElement,
  PaymentElement,
  StripeCheckout,
} from "superwall/checkout/stripe";
import type { StripeCheckoutOptions } from "superwall/checkout/stripe";
import { useColorScheme, useHaptics, useTranslation } from "superwall/hooks";

/**
 * The playground's scenarios, each a different way to build the same
 * purchase. All of them pay through superwall and report the same callbacks.
 */
export const SCENARIOS = ["full", "cardFields", "wallets", "billing"] as const;
export type Scenario = (typeof SCENARIOS)[number];

type Props = {
  product: "trial" | "monthly";
  scenario: Scenario;
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
const FullFields = () => {
  const { t } = useTranslation();
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
 * Stripe's separate card fields, the way many existing checkouts are built,
 * with the paywall's own email field passed to `<StripeCheckout email>`.
 */
const CardFields = ({ email, onEmail }: { email: string; onEmail: (email: string) => void }) => {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const style = useMemo(
    () => ({
      base: {
        color: scheme === "dark" ? "#fdfef6" : "#0c0b0a",
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        "::placeholder": { color: "#8a8984" },
      },
    }),
    [scheme],
  );
  return (
    <div className="form">
      <label className="field">
        <span>{t("form.email")}</span>
        <input
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => onEmail(event.target.value)}
        />
      </label>
      <label className="field">
        <span>{t("form.cardNumber")}</span>
        <CardNumberElement className="input" options={{ style, showIcon: true }} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>{t("form.expiry")}</span>
          <CardExpiryElement className="input" options={{ style }} />
        </label>
        <label className="field">
          <span>{t("form.cvc")}</span>
          <CardCvcElement className="input" options={{ style }} />
        </label>
      </div>
    </div>
  );
};

/** Only the one-tap wallets: the wallet asks for the email itself. */
const WalletFields = () => (
  <div className="form">
    <ExpressCheckoutElement options={{ buttonHeight: 52, buttonType: { applePay: "subscribe" } }} />
  </div>
);

/**
 * An accordion card form with Stripe's billing address: the address goes
 * onto the payment method, and `stripeMetadata` onto the subscription.
 */
const BillingFields = () => (
  <div className="form">
    <LinkAuthenticationElement />
    <AddressElement options={{ mode: "billing" }} />
    <PaymentElement options={{ layout: "accordion" }} />
  </div>
);

const Fields = ({
  scenario,
  email,
  onEmail,
}: {
  scenario: Scenario;
  email: string;
  onEmail: (email: string) => void;
}) => {
  const { status } = useCheckout();
  if (status === "unavailable") return null;
  if (scenario === "cardFields") return <CardFields email={email} onEmail={onEmail} />;
  if (scenario === "wallets") return <WalletFields />;
  if (scenario === "billing") return <BillingFields />;
  return <FullFields />;
};

/**
 * A purchase button built on `useCheckout().submit()` instead of
 * `<PurchaseButton>`, for a paywall that wants its own: it shows why an
 * incomplete form didn't pay.
 */
const OwnButton = ({ label }: { label: string }) => {
  const { t } = useTranslation();
  const { canSubmit, submit } = useCheckout();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  return (
    <>
      {problem ? (
        <p className="notice notice--error" role="status">
          {problem}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--primary"
        disabled={!canSubmit}
        onClick={async () => {
          setProblem(undefined);
          const result = await submit();
          if (result.status === "incomplete") {
            setProblem(result.error.message || t("form.incomplete"));
          }
        }}
      >
        {label}
      </button>
    </>
  );
};

/**
 * Everything inside `<StripeCheckout>` reads the form's state from
 * `useCheckout()`, which reads the same for any store, so this summary and
 * its button would work unchanged in another store's form.
 */
const Summary = ({ scenario }: { scenario: Scenario }) => {
  const { t } = useTranslation();
  const { status, amounts, failure, message } = useCheckout();
  const label = amounts?.dueNow === 0 ? t("purchase.startTrial") : t("purchase.subscribe");

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
      {scenario === "wallets" ? null : scenario === "cardFields" ? (
        <OwnButton label={status === "paying" ? t("purchase.paying") : label} />
      ) : (
        <PurchaseButton className="button button--primary">
          {status === "paying" ? t("purchase.paying") : label}
        </PurchaseButton>
      )}
    </>
  );
};

/**
 * A wallet row, a card form and a purchase button for one plan. superwall
 * prices the form from the product, takes the payment, runs 3D Secure and
 * the free trial, and completes the purchase; the callbacks report it.
 */
export function CheckoutForm({ product, scenario, onCompleted }: Props) {
  const haptics = useHaptics();
  const options = useStripeAppearance();
  const [email, setEmail] = useState("");

  return (
    <StripeCheckout
      key={scenario}
      product={product}
      options={options}
      {...(scenario === "cardFields" ? { email } : {})}
      {...(scenario === "billing" ? { stripeMetadata: { source: "elements-playground" } } : {})}
      onComplete={() => {
        haptics.success();
        onCompleted();
      }}
      onFailure={(failure) => console.info("onFailure", failure)}
      onAbandon={() => console.info("onAbandon")}
    >
      <Fields scenario={scenario} email={email} onEmail={setEmail} />
      <div className="actions">
        <Summary scenario={scenario} />
      </div>
    </StripeCheckout>
  );
}
