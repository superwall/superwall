import { useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Index() {
  const router = useRouter();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const price = annual?.variables.price;

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
      </div>

      <p className="note">{t("paywall.note")}</p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            const result = await purchase("annual");
            if (result.status === "abandoned") {
              router.push("offer", { transition: "sheet" });
            }
          }}
        >
          {price ? t("paywall.cta", { price }) : t("paywall.ctaBare")}
        </button>
      </div>
    </main>
  );
}
