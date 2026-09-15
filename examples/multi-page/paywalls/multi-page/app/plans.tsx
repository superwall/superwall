import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Plans() {
  const router = useRouter();
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

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
          onClick={() => {
            haptics.light();
            purchase("annual");
          }}
        >
          {price ? t("plans.cta", { price }) : t("plans.ctaBare")}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            restore();
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
      </div>
    </main>
  );
}
