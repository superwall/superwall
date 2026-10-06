import { useState } from "react";
import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Plans() {
  const router = useRouter();
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [notice, setNotice] = useState<string | null>(null);

  const annual = getProduct("annual");
  const price = annual?.variables.price;
  const monthly = annual?.variables.monthlyPrice;

  return (
    <main className="page page--chromed">
      <div className="lede">
        <h1>{t("plans.title")}</h1>
        {monthly && <p>{t("plans.perMonth", { price: monthly })}</p>}
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            setNotice(null);
            // Never a loading state here: the store sheet is the feedback.
            const result = await purchase("annual");
            if (result.status === "completed") haptics.success();
            else if (result.status === "failed") setNotice(t("plans.purchaseFailed"));
            // abandoned: the user closed the store sheet — nothing changes, nothing is said.
          }}
        >
          {price ? t("plans.cta", { price }) : t("plans.ctaBare")}
        </button>
        <button
          type="button"
          className="link"
          onClick={async () => {
            haptics.light();
            setNotice(null);
            // "Nothing to restore" and a store error both land as `failed`; the copy covers both.
            const result = await restore();
            setNotice(result.status === "restored" ? t("plans.restored") : t("plans.restoreFailed"));
          }}
        >
          {t("plans.restore")}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            router.dismissAll();
          }}
        >
          {t("plans.startOver")}
        </button>
        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      </div>
    </main>
  );
}
