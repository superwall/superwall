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
  const [notice, setNotice] = React.useState<string>();
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
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {/* purchase() resolves completed | abandoned | failed; the button never shows a loading state — the store sheet is the feedback. */}
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            const result = await purchase(selected);
            if (result.status === "completed") haptics.success();
            else if (result.status === "failed") setNotice(t("purchase.failed"));
            // abandoned: the user closed the store sheet — nothing changes, nothing is said
          }}
        >
          {t("paywall.continue")}
        </button>
        <button
          type="button"
          className="link"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            const result = await restore();
            if (result.status === "restored") haptics.success();
            setNotice(result.status === "restored" ? t("restore.restored") : t("restore.failed"));
          }}
        >
          {t("paywall.restore")}
        </button>
      </div>
    </main>
  );
}
