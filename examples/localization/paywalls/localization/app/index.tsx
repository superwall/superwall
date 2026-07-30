import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";

export default function Index() {
  const { t, locale } = useTranslation();
  const { close, restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const price = annual?.variables.price;
  const monthly = annual?.variables.monthlyPrice;

  return (
    <main className="page">
      <header className="bar">
        <span className="locale">{locale}</span>
        <button type="button" className="close" aria-label={t("paywall.close")} onClick={close}>
          ✕
        </button>
      </header>

      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
        {monthly && <p>{t("paywall.perMonth", { price: monthly })}</p>}
      </div>

      <p className="note">{t("paywall.hint")}</p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase("annual");
          }}
        >
          {price ? t("paywall.cta", { price }) : t("paywall.ctaBare")}
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
