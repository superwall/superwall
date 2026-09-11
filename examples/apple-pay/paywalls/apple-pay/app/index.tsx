import { useState } from "react";
import { useDiscount, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import type { AppliedDiscount, DiscountedProduct } from "superwall/hooks";

const PLANS = [
  { reference: "trial", label: "plans.trial", note: "plans.trialNote" },
  { reference: "intro", label: "plans.intro", note: "plans.introNote" },
  { reference: "monthly", label: "plans.monthly", note: "plans.monthlyNote" },
] as const;

type PlanReference = (typeof PLANS)[number]["reference"];

/**
 * "15% off forever", "$5 off on your first payment" — assembled here, from
 * this paywall's own message catalog and Stripe's coupon fields, because the
 * hook hands over the parts rather than a sentence in one language.
 */
const describeDiscount = (
  discount: AppliedDiscount,
  product: DiscountedProduct | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): string => {
  const amount =
    discount.percentOff != null
      ? t("discount.percentOff", { percent: discount.percentOff })
      : t("discount.amountOff", { amount: product?.savingsPrice ?? "" });
  const duration =
    discount.duration === "repeating"
      ? t("discount.repeating", { months: discount.durationInMonths ?? 0 })
      : t(`discount.${discount.duration ?? "forever"}`);
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
    onDropped: () => setCodeError(t("promo.dropped")),
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
        ? t("promo.unknown")
        : result.reason === "no_applicable_products"
          ? t("promo.ineligible")
          : t("promo.failed"),
    );
  };

  const priceFor = (reference: PlanReference) => {
    const discounted = getDiscountedProduct(reference);
    if (discounted?.applies) return discounted.discountedPrice;
    return getProduct(reference)?.variables.price;
  };

  const strikethroughFor = (reference: PlanReference) => {
    const discounted = getDiscountedProduct(reference);
    return discounted?.applies ? discounted.price : undefined;
  };

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
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
                {t(plan.label, { price: getProduct(plan.reference)?.variables.price ?? "" })}
                <span className="plan-note">{t(plan.note)}</span>
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
            {` · ${describeDiscount(applied.discount, getDiscountedProduct(selected), t)}`}
            <button
              type="button"
              className="link"
              onClick={() => {
                haptics.light();
                clear();
              }}
            >
              {t("promo.remove")}
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
              placeholder={t("promo.placeholder")}
              aria-label={t("promo.placeholder")}
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <button type="submit" className="button button--ghost" disabled={isRedeeming || !code}>
              {isRedeeming ? t("promo.applying") : t("promo.apply")}
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
          {isPurchasing ? t("purchase.working") : t("purchase.continue")}
        </button>
      </div>
    </main>
  );
}
