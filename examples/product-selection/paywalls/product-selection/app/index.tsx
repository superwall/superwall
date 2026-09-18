import * as React from "react";
import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { PlanOption } from "../components/PlanOption";

const PLANS = ["annual", "monthly"] as const;

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const [selected, setSelected] = React.useState<(typeof PLANS)[number]>("annual");
  const priced = PLANS.some((reference) => getProduct(reference)?.variables.price);

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
      </div>

      <div className="plans" role="radiogroup" aria-label={t("paywall.plans")}>
        {PLANS.map((reference) => {
          const product = getProduct(reference);
          const monthly = product?.variables.monthlyPrice;
          return (
            <PlanOption
              key={reference}
              name={reference === "annual" ? t("plans.annual") : t("plans.monthly")}
              badge={reference === "annual" ? t("plans.bestValue") : undefined}
              price={product?.variables.price}
              caption={
                reference === "annual" && monthly
                  ? t("plans.perMonth", { price: monthly })
                  : undefined
              }
              selected={selected === reference}
              onSelect={() => {
                haptics.selection();
                setSelected(reference);
              }}
            />
          );
        })}
      </div>

      {!priced && (
        <p className="note">
          {t("note.lead")}
          <code>config.ts</code>
          {t("note.body")}
        </p>
      )}

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase(selected);
          }}
        >
          {t("paywall.continue")}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            restore();
          }}
        >
          {t("paywall.restore")}
        </button>
      </div>
    </main>
  );
}
