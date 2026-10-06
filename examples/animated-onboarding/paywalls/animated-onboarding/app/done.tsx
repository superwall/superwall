import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";

/** "finish": the bar fills its last stretch and holds for a beat, then this page rises. */
export const transition = "story-finish";

export default function Done() {
  const { close } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const price = annual?.variables.price;

  return (
    <main className="page" data-flow-page="">
      <div className="lede lede--done">
        <h1 data-flow-line="">{t("done.title")}</h1>
        <p data-flow-line="">{t("done.subtitle")}</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          data-next-button=""
          onClick={() => {
            haptics.light();
            purchase("annual");
          }}
        >
          {price ? t("done.cta", { price }) : t("done.ctaBare")}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            close();
          }}
        >
          {t("done.later")}
        </button>
      </div>
    </main>
  );
}
