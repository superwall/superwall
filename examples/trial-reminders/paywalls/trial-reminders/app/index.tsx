import * as React from "react";
import {
  useActions,
  useHaptics,
  useProducts,
  usePurchase,
  useSuperwallEvent,
  useTranslation,
} from "superwall/hooks";

// The catalog has no plural engine: fork on the count ourselves.
const plural = new Intl.PluralRules("en");

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [scheduled, setScheduled] = React.useState(false);

  // One line of copy for an outcome worth saying; nothing for an abandoned sheet.
  const [notice, setNotice] = React.useState<string>();

  useSuperwallEvent("freeTrial_start", () => {
    haptics.success();
    setScheduled(true);
  });

  const annual = getProduct("annual");
  // Variables arrive as strings on device; coerce before counting.
  const days = annual?.variables.trialPeriodDays ? Number(annual.variables.trialPeriodDays) : undefined;

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>
          {days
            ? plural.select(days) === "one"
              ? t("paywall.trialOne")
              : t("paywall.trial", { days })
            : t("paywall.trialBare")}
        </p>
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
            // The reminder is the SDK's job once the trial starts — nothing to schedule here.
            const result = await purchase("annual");
            if (result.status === "completed") haptics.success(); // the SDK dismisses the paywall
            else if (result.status === "failed") setNotice(t("purchase.failed")); // iOS only; the button stays enabled
            // abandoned: the user closed the sheet — nothing changes, nothing is said
          }}
        >
          {days ? t("paywall.cta", { days }) : t("paywall.ctaBare")}
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
      </div>
    </main>
  );
}
