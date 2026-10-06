import * as React from "react";
import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";

export default function Index() {
  const { t, locale } = useTranslation();
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  // One line of copy for an outcome worth saying; nothing for an abandoned sheet.
  const [notice, setNotice] = React.useState<string>();

  const annual = getProduct("annual");
  const price = annual?.variables.price;
  const monthly = annual?.variables.monthlyPrice;

  return (
    <main className="page">
      <header className="bar">
        <span className="locale">{locale}</span>
      </header>

      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
        {monthly && <p>{t("paywall.perMonth", { price: monthly })}</p>}
      </div>

      <p className="note">{t("paywall.hint")}</p>

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
            // Never a loading state: the store sheet is the feedback and the SDK owns it.
            const result = await purchase("annual");
            if (result.status === "completed")
              haptics.success(); // the SDK dismisses the paywall
            else if (result.status === "failed") setNotice(t("purchase.failed")); // iOS only; the button stays enabled
            // abandoned: the user closed the sheet — nothing changes, nothing is said
          }}
        >
          {price ? t("paywall.cta", { price }) : t("paywall.ctaBare")}
        </button>
        <button
          type="button"
          className="link"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            // "Nothing to restore" and a store error both resolve `failed`; the copy covers both.
            const result = await restore();
            if (result.status === "restored") haptics.success();
            setNotice(result.status === "restored" ? t("restore.restored") : t("restore.failed"));
          }}
        >
          {t("common.restore")}
        </button>
      </div>
    </main>
  );
}
