import { useDevice, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";

const FEATURES = [
  "features.workouts",
  "features.offline",
  "features.formChecks",
  "features.coaching",
] as const;

export default function Index() {
  const { orientation } = useDevice();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const price = annual?.variables.price;
  const landscape = orientation === "landscape";

  return (
    <main className={`page ${landscape ? "page--landscape" : ""}`}>
      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
      </div>

      <ul className="features">
        {FEATURES.map((feature) => (
          <li key={feature}>{t(feature)}</li>
        ))}
      </ul>

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
        <span className="orientation">{orientation}</span>
      </div>
    </main>
  );
}
