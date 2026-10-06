import * as React from "react";
import { useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "sheet";

export default function Offer() {
  const router = useRouter();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const [notice, setNotice] = React.useState<string>();

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
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            const result = await purchase("discount");
            if (result.status === "completed") haptics.success(); // the SDK dismisses the paywall
            else if (result.status === "failed") setNotice(t("purchase.failed")); // iOS only; the button stays enabled
            // abandoned: one offer, not two — a second sheet would be nagging
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
