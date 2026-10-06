import { useState } from "react";
import {
  useActions,
  useHaptics,
  useProducts,
  usePurchase,
  useIntroductoryOffer,
  useTranslation,
} from "superwall/hooks";

export default function Index() {
  const { eligible } = useIntroductoryOffer();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { restore } = useActions();
  const { t, locale } = useTranslation();
  const haptics = useHaptics();
  const [notice, setNotice] = useState<string>();

  const annual = getProduct("annual");
  // Variables arrive as strings on device; coerce before counting.
  const rawDays = annual?.variables.trialPeriodDays;
  const days = rawDays === undefined || rawDays === "" ? undefined : Number(rawDays);
  const price = annual?.variables.price;

  // The catalog has no plural engine: fork on the count with the locale's own rules.
  const one = days !== undefined && new Intl.PluralRules(locale).select(days) === "one";

  const trialCopy = () => {
    if (days === undefined || Number.isNaN(days)) return t("paywall.trialUnknown");
    if (one) return price ? t("paywall.trialOne", { price }) : t("paywall.trialOneBare");
    return price ? t("paywall.trial", { days, price }) : t("paywall.trialBare", { days });
  };

  return (
    <main className="page">
      <div className="lede">
        <h1>{eligible ? t("paywall.titleEligible") : t("paywall.titleIneligible")}</h1>
        <p>{eligible ? trialCopy() : t("paywall.ineligible")}</p>
      </div>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">introductoryOffer.eligible</span>
          <span className="kv-value">{String(eligible)}</span>
        </div>
        <div className="kv">
          <span className="kv-key">trialPeriodDays</span>
          <span className="kv-value">{rawDays ?? t("paywall.empty")}</span>
        </div>
      </div>

      <p className="note">{t("paywall.hint")}</p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            const result = await purchase("annual");
            if (result.status === "completed")
              haptics.success(); // the SDK dismisses (postPurchase)
            else if (result.status === "failed") setNotice(t("purchase.failed")); // iOS only; the button stays
            // abandoned: the store sheet was closed — nothing changes, nothing is said
          }}
        >
          {eligible
            ? t("paywall.ctaTrial")
            : price
              ? t("paywall.ctaPrice", { price })
              : t("paywall.ctaBare")}
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
          {t("paywall.restore")}
        </button>
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </main>
  );
}
