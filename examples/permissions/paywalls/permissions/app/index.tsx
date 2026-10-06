import * as React from "react";
import { useActions, useHaptics, useTranslation } from "superwall/hooks";

const PERMISSIONS = [
  { type: "notification", label: "permissions.notification" },
  { type: "camera", label: "permissions.camera" },
  { type: "microphone", label: "permissions.microphone" },
  { type: "location", label: "permissions.location" },
  { type: "background_location", label: "permissions.backgroundLocation" },
  { type: "contacts", label: "permissions.contacts" },
  { type: "read_images", label: "permissions.readImages" },
  { type: "read_video", label: "permissions.readVideo" },
  { type: "tracking", label: "permissions.tracking" },
] as const;

/**
 * What the app answered. A permission resolves granted | denied | unsupported;
 * a callback resolves success | failure. Every one of them is an outcome the
 * page shows in its own colour — a denial is not an error.
 */
type Outcome = "granted" | "denied" | "unsupported" | "success" | "failure";
type Entry = { name: string; status: Outcome };

const TONE: Record<Outcome, "success" | "destructive" | "neutral"> = {
  granted: "success",
  success: "success",
  denied: "destructive",
  failure: "destructive",
  unsupported: "neutral",
};

export default function Index() {
  const { requestPermission, requestCallback } = useActions();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [log, setLog] = React.useState<Entry[]>([]);
  const note = (entry: Entry) => setLog((all) => [entry, ...all].slice(0, 6));

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
      </div>

      <div className="rows">
        {PERMISSIONS.map((permission) => (
          <button
            key={permission.type}
            type="button"
            className="kv kv--button"
            onClick={async () => {
              haptics.light();
              note({
                name: permission.type,
                status: await requestPermission(permission.type),
              });
            }}
          >
            <span className="kv-value">{t(permission.label)}</span>
            <span className="kv-key">{permission.type}</span>
          </button>
        ))}
      </div>

      <div className="log" role="status" aria-live="polite" aria-label={t("log.label")}>
        {log.length === 0 ? (
          <span className="log-empty">{t("log.empty")}</span>
        ) : (
          log.map((entry, index) => (
            <div className="log-row" key={`${entry.name}-${index}`}>
              <span className="log-name">{entry.name}</span>
              <span className={`chip chip--${TONE[entry.status]}`}>
                {t(`status.${entry.status}`)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="lede">
        <h2>{t("callbacks.title")}</h2>
        <p>
          {t("callbacks.lead")}
          <strong>{t("callbacks.emphasis")}</strong>
          {t("callbacks.body")}
        </p>
      </div>

      <p className="note">{t("callbacks.note")}</p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            const result = await requestCallback("checkAccount");
            note({ name: "checkAccount", status: result.status });
          }}
        >
          {t("callbacks.run")}
        </button>
      </div>
    </main>
  );
}
