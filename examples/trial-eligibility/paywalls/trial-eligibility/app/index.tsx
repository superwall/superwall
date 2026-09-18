import {
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
  const { t } = useTranslation();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const days = annual?.variables.trialPeriodDays;
  const price = annual?.variables.price;

  return (
    <main className="page">
      <div className="lede">
        <h1>{eligible ? t("paywall.titleEligible") : t("paywall.titleIneligible")}</h1>
        <p>
          {eligible
            ? days
              ? price
                ? t("paywall.trial", { days, price })
                : t("paywall.trialBare", { days })
              : t("paywall.trialUnknown")
            : t("paywall.ineligible")}
        </p>
      </div>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">introductoryOffer.eligible</span>
          <span className="kv-value">{String(eligible)}</span>
        </div>
        <div className="kv">
          <span className="kv-key">trialPeriodDays</span>
          <span className="kv-value">{days ?? t("paywall.empty")}</span>
        </div>
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
          {eligible ? t("paywall.ctaTrial") : (price ?? t("paywall.ctaBare"))}
        </button>
      </div>
    </main>
  );
}
