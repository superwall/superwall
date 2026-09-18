import { useTranslation, useVariables } from "superwall/hooks";
export default function Index() {
  const { device, user, params } = useVariables();
  const { t } = useTranslation();

  const name = typeof user.firstName === "string" ? user.firstName : undefined;
  const empty = t("rows.empty");

  return (
    <main className="page">
      <div className="lede">
        <h1>{name ? t("paywall.welcome", { name }) : t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
      </div>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">device.platform</span>
          <span className="kv-value">{device.platform ?? empty}</span>
        </div>
        <div className="kv">
          <span className="kv-key">device.deviceLocale</span>
          <span className="kv-value">{device.deviceLocale ?? empty}</span>
        </div>
        <div className="kv">
          <span className="kv-key">user.firstName</span>
          <span className="kv-value">{name ?? empty}</span>
        </div>
        <div className="kv">
          <span className="kv-key">params.event_name</span>
          <span className="kv-value">
            {typeof params.event_name === "string" ? params.event_name : empty}
          </span>
        </div>
      </div>

      <p className="note">
        {t("note.lead")}
        <code>user</code>
        {t("note.from")}
        <code>setUserAttributes</code>
        {t("note.and")}
        <code>params</code>
        {t("note.placement")}
      </p>
    </main>
  );
}
