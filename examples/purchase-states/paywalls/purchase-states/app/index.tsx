import * as React from "react";
import {
  useActions,
  useHaptics,
  useProducts,
  usePurchase,
  useSuperwallEvent,
  useTranslation,
} from "superwall/hooks";

type Entry = { name: string; detail?: string };

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const [log, setLog] = React.useState<Entry[]>([]);
  const [notice, setNotice] = React.useState<string>();
  const add = React.useCallback((entry: Entry) => setLog((all) => [entry, ...all]), []);

  // Events only log here: the haptic belongs to the awaited result below, so a
  // restore (which also arrives as transaction_complete) is not felt twice.
  useSuperwallEvent("transaction_complete", () => {
    add({ name: "transaction_complete", detail: t("log.purchased") });
  });
  useSuperwallEvent("transaction_abandon", () => {
    add({ name: "transaction_abandon", detail: t("log.abandoned") });
  });
  useSuperwallEvent("freeTrial_start", () => {
    add({ name: "freeTrial_start", detail: t("log.trialStarted") });
  });

  const annual = getProduct("annual");
  const price = annual?.variables.price;

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
      </div>

      <div className="log">
        {log.length === 0 ? (
          <span className="log-empty">{t("log.empty")}</span>
        ) : (
          log.map((entry, index) => (
            <div className="log-row" key={`${entry.name}-${index}`}>
              <span className="log-name">{entry.name}</span>
              <span className="log-detail">{entry.detail}</span>
            </div>
          ))
        )}
      </div>

      <p className="note">
        <code>purchase()</code>
        {t("note.and")}
        <code>restore()</code>
        {t("note.resolve")}
        <code>transaction_restore</code>
        {t("note.never")}
        <code>transaction_complete</code>
        {t("note.end")}
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
            // Never a loading state here: the store sheet is the feedback.
            const result = await purchase("annual");
            add({ name: `purchase() → ${result.status}`, detail: t("log.resolved") });
            if (result.status === "completed") haptics.success(); // the SDK dismisses (postPurchase)
            else if (result.status === "failed") setNotice(t("paywall.failed")); // iOS only; say so, keep the button
            // abandoned: the user closed the store sheet — nothing changes, nothing is said
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
            add({
              name: `restore_${result.status}`,
              detail: result.status === "restored" ? t("log.restored") : t("log.nothingToRestore"),
            });
          }}
        >
          {t("paywall.restore")}
        </button>
      </div>
    </main>
  );
}
