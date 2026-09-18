import * as React from "react";
import {
  useHaptics,
  useProducts,
  usePurchase,
  useSuperwallEvent,
  useTranslation,
} from "superwall/hooks";

export default function Index() {
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [scheduled, setScheduled] = React.useState(false);

  useSuperwallEvent("freeTrial_start", () => {
    haptics.success();
    setScheduled(true);
  });

  const annual = getProduct("annual");
  const days = annual?.variables.trialPeriodDays;

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{days ? t("paywall.trial", { days }) : t("paywall.trialBare")}</p>
      </div>

      <pre className="snippet">
        {"definePaywall({\n"}
        {"  notifications: {\n"}
        {"    trialReminder: {\n"}
        {"      title: "}
        <b>"Your trial ends tomorrow"</b>
        {",\n      body: "}
        <b>"Keep Pro, or cancel in Settings."</b>
        {",\n      beforeTrialEndDays: "}
        <b>1</b>
        {",\n    },\n  },\n})"}
      </pre>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">{t("paywall.reminderKey")}</span>
          <span className="kv-value">
            {scheduled ? t("paywall.reminderScheduled") : t("paywall.reminderPending")}
          </span>
        </div>
        <div className="kv">
          <span className="kv-key">{t("paywall.firesKey")}</span>
          <span className="kv-value">{t("paywall.firesValue")}</span>
        </div>
      </div>

      <p className="note">
        {t("paywall.noteDeclaredIn")} <code>config.ts</code>
        {t("paywall.noteRest")}
      </p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase("annual");
          }}
        >
          {days ? t("paywall.cta", { days }) : t("paywall.ctaBare")}
        </button>
      </div>
    </main>
  );
}
