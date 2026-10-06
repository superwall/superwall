import { useState } from "react";
import {
  useActions,
  useDiscount,
  useHaptics,
  useProducts,
  usePurchase,
  useTranslation,
} from "superwall/hooks";
import type { AppliedDiscount, DiscountedProduct } from "superwall/hooks";

const PLANS = [
  { reference: "trial", label: "plans.trial", note: "plans.trialNote" },
  { reference: "intro", label: "plans.intro", note: "plans.introNote" },
  { reference: "monthly", label: "plans.monthly", note: "plans.monthlyNote" },
] as const;

type Plan = (typeof PLANS)[number];
type PlanReference = Plan["reference"];

/**
 * "15% off forever", "$5 off on your first payment" — assembled here, from
 * this paywall's own message catalog and Stripe's coupon fields, because the
 * hook hands over the parts rather than a sentence in one language. Nothing
 * is said about the amount until the store has priced it.
 */
const describeDiscount = (
  discount: AppliedDiscount,
  product: DiscountedProduct | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): string | undefined => {
  const amount =
    discount.percentOff != null
      ? t("discount.percentOff", { percent: discount.percentOff })
      : product?.savingsPrice
        ? t("discount.amountOff", { amount: product.savingsPrice })
        : undefined;
  if (!amount) return undefined;
  const duration =
    discount.duration === "repeating"
      ? t("discount.repeating", { months: discount.durationInMonths ?? 0 })
      : t(`discount.${discount.duration ?? "forever"}`);
  return `${amount} ${duration}`;
};

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const [selected, setSelected] = useState<PlanReference>("trial");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  // One line of copy for an outcome worth saying; nothing for an abandoned sheet.
  const [notice, setNotice] = useState<string>();

  const { t } = useTranslation();
  const { redeem, clear, applied, isRedeeming, getDiscountedProduct } = useDiscount({
    onDropped: () => setCodeError(t("promo.dropped")),
  });

  const applyCode = async () => {
    if (isRedeeming) return;
    setCodeError(undefined);
    const result = await redeem(code);
    if (result.valid) {
      haptics.success();
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

  // The intro plan names its price in the label; until the store supplies one it says what it is instead.
  const labelFor = (plan: Plan) => {
    if (plan.reference !== "intro") return t(plan.label);
    const price = getProduct("intro")?.variables.price;
    return price ? t("plans.intro", { price }) : t("plans.introBare");
  };

  const description = applied
    ? describeDiscount(applied.discount, getDiscountedProduct(selected), t)
    : undefined;

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
      </div>

      <div className="plans" role="radiogroup" aria-label={t("plans.label")}>
        {PLANS.map((plan) => {
          const original = strikethroughFor(plan.reference);
          return (
            <button
              key={plan.reference}
              type="button"
              className="plan"
              role="radio"
              aria-checked={selected === plan.reference}
              onClick={() => {
                haptics.selection();
                setSelected(plan.reference);
              }}
            >
              <span className="plan-label">
                {labelFor(plan)}
                <span className="plan-note">{t(plan.note)}</span>
              </span>
              <span className="plan-price">
                {original ? <s className="plan-was">{original}</s> : null}
                {priceFor(plan.reference) ?? t("plans.empty")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="promo">
        {applied ? (
          <p className="promo-applied" role="status">
            <strong>{t("discount.applied", { code: applied.code })}</strong>
            {description ? ` · ${description}` : null}
            <button
              type="button"
              className="link promo-remove"
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
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t("promo.placeholder")}
              aria-label={t("promo.placeholder")}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
            />
            <button type="submit" className="button" disabled={!code}>
              {isRedeeming ? t("promo.applying") : t("promo.apply")}
            </button>
          </form>
        )}
        {codeError ? (
          <p className="promo-error" role="status">
            {codeError}
          </p>
        ) : null}
      </div>

      <div className="actions">
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            // Never a loading state: the Apple Pay sheet is the feedback and the SDK owns it.
            const result = await purchase(selected);
            if (result.status === "completed") haptics.success(); // the SDK finishes the checkout
            else if (result.status === "failed") setNotice(t("purchase.failed")); // the button stays enabled
            // abandoned: the shopper closed the sheet — nothing changes, nothing is said
          }}
        >
          {t("purchase.continue")}
        </button>
        <button
          type="button"
          className="link"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            // "Nothing to restore" and a store error both resolve `failed`; the copy covers both.
            const result = await restore();
            if (result.status === "restored") haptics.success();
            setNotice(result.status === "restored" ? t("restore.restored") : t("restore.failed"));
          }}
        >
          {t("purchase.restore")}
        </button>
      </div>
    </main>
  );
}
