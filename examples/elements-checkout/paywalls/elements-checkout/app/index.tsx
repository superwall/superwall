import { useState } from "react";
import { useHaptics, useProducts, useTranslation } from "superwall/hooks";
import { CheckoutForm } from "../components/CheckoutForm";

const PLANS = [
  { reference: "trial", label: "plans.trial", note: "plans.trialNote" },
  { reference: "monthly", label: "plans.monthly", note: "plans.monthlyNote" },
] as const;

type PlanReference = (typeof PLANS)[number]["reference"];

export default function Index() {
  const { t } = useTranslation();
  const haptics = useHaptics();
  const { getProduct } = useProducts();
  const [selected, setSelected] = useState<PlanReference>("trial");
  const [done, setDone] = useState(false);

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
      </div>

      <div className="plans" role="radiogroup" aria-label={t("plans.label")}>
        {PLANS.map((plan) => (
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
              {t(plan.label)}
              <span className="plan-note">{t(plan.note)}</span>
            </span>
            <span className="plan-price">
              {getProduct(plan.reference)?.variables.price ?? t("plans.empty")}
            </span>
          </button>
        ))}
      </div>

      {done ? (
        <p className="notice" role="status">
          {t("purchase.completed")}
        </p>
      ) : (
        <CheckoutForm product={selected} onCompleted={() => setDone(true)} />
      )}
    </main>
  );
}
