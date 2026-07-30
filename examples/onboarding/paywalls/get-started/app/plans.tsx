import * as React from "react";
import { useRouter } from "superwall/navigation";
import { useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { resolveVariables } from "superwall/config";
import config from "../config";
import { useAnswers } from "../components/Answers";

export default function Plans() {
  const router = useRouter();
  const { t } = useTranslation();
  const { defaultPlan } = resolveVariables(config.variables);
  const { getProduct } = useProducts();
  const { purchase, isPurchasing } = usePurchase();
  const [answers] = useAnswers();
  const [selected, setSelected] = React.useState(defaultPlan);

  const headline = answers.goal
    ? t(`plans.headline.${answers.goal}`, { days: answers.daysPerWeek })
    : t("plans.headline.generic");

  return (
    <main className="screen">
      <h1 className="title">{headline}</h1>
      <p className="subtitle">{t("plans.subtitle")}</p>

      <div className="plans">
        {(["annual", "monthly"] as const).map((reference) => {
          const product = getProduct(reference);
          return (
            <button
              key={reference}
              type="button"
              className={selected === reference ? "plan plan-selected" : "plan"}
              onClick={() => setSelected(reference)}
            >
              <span className="plan-name">{t(`plans.${reference}`)}</span>
              <span className="plan-price">{product?.variables.price}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="primary"
        disabled={isPurchasing}
        onClick={() => purchase(selected)}
      >
        {isPurchasing ? t("plans.working") : t("plans.subscribe")}
      </button>

      <button type="button" className="link" onClick={() => router.push("terms")}>
        {t("plans.terms")}
      </button>
    </main>
  );
}
