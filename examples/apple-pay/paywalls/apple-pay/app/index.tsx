import { useState } from "react";
import { useDiscount, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import type { DiscountSummary } from "superwall/hooks";

const PLANS = [
  { reference: "trial", label: "3-day free trial", note: "then billed monthly" },
  { reference: "intro", label: "3 days for $3.49", note: "then billed monthly" },
  { reference: "monthly", label: "Monthly", note: "billed every month" },
] as const;

type PlanReference = (typeof PLANS)[number]["reference"];

/**
 * "15% off forever", "$5 off on your first payment" — assembled here, from
 * this paywall's own message catalog, because `summary` deliberately carries
 * the parts rather than a sentence in one language.
 */
const describeDiscount = (
  summary: DiscountSummary,
  t: (key: string, values?: Record<string, string | number>) => string,
): string => {
  const amount =
    summary.kind === "percent"
      ? t("discount.percentOff", { percent: summary.percentOff ?? 0 })
      : t("discount.amountOff", { amount: summary.amountOffPrice ?? summary.savingsPrice });
  const duration =
    summary.duration === "repeating"
      ? t("discount.repeating", { months: summary.durationInMonths ?? 0 })
      : t(`discount.${summary.duration}`);
  return `${amount} ${duration}`;
};

export default function Index() {
  const { getProduct } = useProducts();
  const { purchase, isPurchasing } = usePurchase();
  const haptics = useHaptics();

  const [selected, setSelected] = useState<PlanReference>("trial");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const { t } = useTranslation();
  const { redeem, clear, applied, isRedeeming, getDiscountedProduct } = useDiscount({
    onDropped: () => setCodeError("That code is no longer valid, so it was removed."),
  });

  const applyCode = async () => {
    setCodeError(null);
    const result = await redeem(code);
    if (result.valid) {
      setCode("");
      return;
    }
    setCodeError(
      result.reason === "code_not_found" || result.reason === "code_invalid"
        ? "We don't recognize that code."
        : result.reason === "no_applicable_products"
          ? "That code doesn't apply to these plans."
          : "We couldn't check that code. Try again.",
    );
  };

  const priceFor = (reference: PlanReference) => {
    const discounted = getDiscountedProduct(reference);
    if (discounted?.applies) return discounted.discountedPrice;
    return getProduct(reference)?.variables.price;
  };

  const strikethroughFor = (reference: PlanReference) => {
    const discounted = getDiscountedProduct(reference);
    return discounted?.applies ? discounted.originalPrice : undefined;
  };

  return (
    <main className="page">
      <div className="lede">
        <h1>Go Pro</h1>
        <p>Pay with Apple Pay in two taps. Cancel any time.</p>
      </div>

      <div className="plans">
        {PLANS.map((plan) => {
          const original = strikethroughFor(plan.reference);
          return (
            <button
              key={plan.reference}
              type="button"
              className={`plan${selected === plan.reference ? " plan--selected" : ""}`}
              aria-pressed={selected === plan.reference}
              onClick={() => {
                haptics.light();
                setSelected(plan.reference);
              }}
            >
              <span className="plan-label">
                {plan.label}
                <span className="plan-note">{plan.note}</span>
              </span>
              <span className="plan-price">
                {original ? <s className="plan-was">{original}</s> : null}
                {priceFor(plan.reference) ?? "—"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="promo">
        {applied ? (
          <p className="promo-applied">
            <strong>{t("discount.applied", { code: applied.code })}</strong>
            {(() => {
              const summary = getDiscountedProduct(selected)?.summary;
              return summary ? ` · ${describeDiscount(summary, t)}` : "";
            })()} <button
              type="button"
              className="link"
              onClick={() => {
                haptics.light();
                clear();
              }}
            >
              Remove
            </button>
          </p>
        ) : (
          <form
            className="promo-form"
            onSubmit={(event) => {
              event.preventDefault();
              haptics.light();
              void applyCode();
            }}
          >
            <input
              className="promo-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Promo code"
              aria-label="Promo code"
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <button type="submit" className="button button--ghost" disabled={isRedeeming || !code}>
              {isRedeeming ? "Checking…" : "Apply"}
            </button>
          </form>
        )}
        {codeError ? <p className="promo-error">{codeError}</p> : null}
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          disabled={isPurchasing}
          onClick={() => {
            haptics.light();
            void purchase(selected);
          }}
        >
          {isPurchasing ? "One moment…" : "Continue"}
        </button>
      </div>
    </main>
  );
}
