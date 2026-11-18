import { useState } from "react";
import { PurchaseButton, useCheckout } from "superwall/checkout";
import type { CheckoutAmounts } from "superwall/checkout";
import {
  AddressElement,
  CardCvcElement,
  CardElement,
  CardExpiryElement,
  CardNumberElement,
  ExpressCheckoutElement,
  LinkAuthenticationElement,
  PaymentElement,
  StripeCheckout,
} from "superwall/checkout/stripe";
import type { ExpressCheckoutElementProps } from "superwall/checkout/stripe";
import { useDiscount, useHaptics, useTranslation } from "superwall/hooks";
import { useCardStyle, useStripeOptions } from "./appearance";

/**
 * The playground's scenarios, each a different way to build the same
 * purchase. All of them pay through superwall and report the same callbacks.
 */
export const SCENARIOS = [
  "full",
  "applePayCard",
  "cardFirst",
  "cardFields",
  "singleLine",
  "wallets",
  "billing",
  "promo",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

type Props = {
  product: "trial" | "monthly";
  scenario: Scenario;
  onCompleted: () => void;
};

/** Minor units (cents) to a price in the shopper's language. */
const formatAmount = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);

const intervalOf = ({ interval, intervalCount }: CheckoutAmounts) =>
  intervalCount === 1 ? interval : `${intervalCount} ${interval}s`;

type EmailProps = { email: string; onEmail: (email: string) => void };

/** Wallet buttons sized and labelled for a subscription. */
const WALLET_OPTIONS = { buttonHeight: 52, buttonType: { applePay: "subscribe" } } as const;

/**
 * Stripe's wallet row with a divider beside it. The row renders nothing on a
 * device with no wallet, so the divider waits until Stripe's `onReady`
 * reports at least one: a shopper without Apple Pay never sees "or pay with card"
 * above nothing.
 */
const Wallets = ({
  divider,
  dividerFirst = false,
  options = WALLET_OPTIONS,
}: {
  divider: string;
  dividerFirst?: boolean;
  options?: ExpressCheckoutElementProps["options"];
}) => {
  const [shown, setShown] = useState(false);
  const line = shown ? <p className="divider">{divider}</p> : null;
  return (
    <>
      {dividerFirst ? line : null}
      <ExpressCheckoutElement
        options={options}
        onReady={({ availablePaymentMethods }) =>
          setShown(Object.values(availablePaymentMethods ?? {}).some(Boolean))
        }
      />
      {dividerFirst ? null : line}
    </>
  );
};

/**
 * The paywall's own email box, for the layouts without Stripe's email field.
 * Its value goes to `<StripeCheckout email>`: every purchase needs one.
 */
const EmailField = ({ email, onEmail }: EmailProps) => {
  const { t } = useTranslation();
  return (
    <label className="field">
      <span>{t("form.email")}</span>
      <input
        className="input"
        type="email"
        autoComplete="email"
        placeholder={t("form.emailPlaceholder")}
        value={email}
        onChange={(event) => onEmail(event.target.value)}
      />
    </label>
  );
};

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
      <Wallets divider={t("form.or")} />
      <LinkAuthenticationElement />
      <PaymentElement options={{ layout: "tabs" }} />
    </div>
  );
};

/** The three classic card fields, in the paywall's own labels and inputs. */
const SplitCard = () => {
  const { t } = useTranslation();
  const style = useCardStyle();
  return (
    <>
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
    </>
  );
};

/**
 * Stripe's separate card fields, the way many existing checkouts are built,
 * with the paywall's own email field passed to `<StripeCheckout email>`.
 */
const CardFields = (props: EmailProps) => (
  <div className="form">
    <EmailField {...props} />
    <SplitCard />
  </div>
);

/**
 * Only Apple Pay above the split card fields: `paymentMethods` turns off
 * every other wallet in the express row. Where the device has no Apple Pay,
 * the row renders nothing and the card fields stand alone.
 */
const ApplePayCardFields = (props: EmailProps) => {
  const { t } = useTranslation();
  return (
    <div className="form">
      <Wallets
        divider={t("form.or")}
        options={{
          ...WALLET_OPTIONS,
          paymentMethods: { applePay: "auto", googlePay: "never", link: "never" },
        }}
      />
      <EmailField {...props} />
      <SplitCard />
    </div>
  );
};

/**
 * The card form first and the wallets below it, in any order a paywall
 * likes: the elements are plain components, placed wherever the layout wants.
 */
const CardFirstFields = () => {
  const { t } = useTranslation();
  return (
    <div className="form">
      <LinkAuthenticationElement />
      <PaymentElement
        options={{ layout: "accordion", wallets: { applePay: "never", googlePay: "never" } }}
      />
      <Wallets
        divider={t("form.orWallet")}
        dividerFirst
        options={{ ...WALLET_OPTIONS, layout: { maxColumns: 2, maxRows: 1 } }}
      />
    </div>
  );
};

/** Stripe's single-line card field, the oldest card element, with an email box. */
const SingleLineFields = (props: EmailProps) => {
  const { t } = useTranslation();
  const style = useCardStyle();
  return (
    <div className="form">
      <EmailField {...props} />
      <label className="field">
        <span>{t("form.card")}</span>
        <CardElement className="input" options={{ style, hidePostalCode: true }} />
      </label>
    </div>
  );
};

/** Only the one-tap wallets: the wallet asks for the email itself. */
const WalletFields = () => (
  <div className="form">
    <ExpressCheckoutElement options={WALLET_OPTIONS} />
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

/**
 * A promotion code box with `useDiscount()`. Redeeming a code re-prices the
 * form: the due amount and the charge both follow the discounted price.
 */
const PromoFields = () => {
  const { t } = useTranslation();
  const { redeem, clear, applied, isRedeeming } = useDiscount();
  const [code, setCode] = useState("");
  const [refused, setRefused] = useState(false);
  return (
    <div className="form">
      <LinkAuthenticationElement />
      <PaymentElement options={{ layout: "tabs" }} />
      {applied ? (
        <div className="promo">
          <span>{t("promo.applied", { code: applied.code })}</span>
          <button type="button" className="link" onClick={clear}>
            {t("promo.remove")}
          </button>
        </div>
      ) : (
        <form
          className="promo"
          onSubmit={async (event) => {
            event.preventDefault();
            setRefused(false);
            const result = await redeem(code);
            if (!result.valid) setRefused(true);
          }}
        >
          <input
            className="input"
            aria-label={t("promo.label")}
            placeholder={t("promo.label")}
            autoCapitalize="characters"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="submit" className="button" disabled={!code.trim() || isRedeeming}>
            {t("promo.apply")}
          </button>
        </form>
      )}
      {refused ? (
        <p className="notice notice--error" role="status">
          {t("promo.invalid")}
        </p>
      ) : null}
    </div>
  );
};

const Fields = ({ scenario, ...email }: { scenario: Scenario } & EmailProps) => {
  const { status } = useCheckout();
  if (status === "unavailable") return null;
  switch (scenario) {
    case "applePayCard":
      return <ApplePayCardFields {...email} />;
    case "cardFirst":
      return <CardFirstFields />;
    case "cardFields":
      return <CardFields {...email} />;
    case "singleLine":
      return <SingleLineFields {...email} />;
    case "wallets":
      return <WalletFields />;
    case "billing":
      return <BillingFields />;
    case "promo":
      return <PromoFields />;
    default:
      return <FullFields />;
  }
};

/** The layouts with the paywall's own email box, which `<StripeCheckout email>` reads. */
const OWN_EMAIL: readonly Scenario[] = ["applePayCard", "cardFields", "singleLine"];

/** The layouts paid with a button of the paywall's own instead of `<PurchaseButton>`. */
const OWN_BUTTON: readonly Scenario[] = ["applePayCard", "cardFields"];

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
      {scenario === "wallets" ? null : OWN_BUTTON.includes(scenario) ? (
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
  const options = useStripeOptions();
  const [email, setEmail] = useState("");

  return (
    <StripeCheckout
      key={scenario}
      product={product}
      options={options}
      {...(OWN_EMAIL.includes(scenario) ? { email } : {})}
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
