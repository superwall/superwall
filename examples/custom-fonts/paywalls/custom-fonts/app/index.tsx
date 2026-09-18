import { useTranslation } from "superwall/hooks";

export default function Index() {
  const { t } = useTranslation();

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
      </div>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">{t("paywall.headline.key")}</span>
          <span className="kv-value">{t("paywall.headline.value")}</span>
        </div>
        <div className="kv">
          <span className="kv-key">{t("paywall.mono.key")}</span>
          <span className="kv-value">{t("paywall.mono.value")}</span>
        </div>
      </div>

      <p className="note">
        {t("paywall.note.before")} <code>assets/</code> {t("paywall.note.between")}{" "}
        <code>@font-face</code> {t("paywall.note.after")}
      </p>
    </main>
  );
}
