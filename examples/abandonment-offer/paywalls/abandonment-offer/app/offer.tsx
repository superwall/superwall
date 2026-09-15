import { useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "sheet";

export default function Offer() {
  const router = useRouter();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const discount = getProduct("discount");
  const price = discount?.variables.price;

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("offer.title")}</h1>
        <p>{t("offer.subtitle")}</p>
      </div>

      <p className="note">{t("offer.note")}</p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase("discount");
          }}
        >
          {price ? t("offer.cta", { price }) : t("offer.ctaBare")}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            router.back();
          }}
        >
          {t("offer.decline")}
        </button>
      </div>
    </main>
  );
}
