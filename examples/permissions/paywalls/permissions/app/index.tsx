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

export default function Index() {
  const { requestPermission, requestCallback } = useActions();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [log, setLog] = React.useState<string[]>([]);
  const note = (line: string) => setLog((all) => [line, ...all].slice(0, 6));

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
              note(
                t("log.line", {
                  name: permission.type,
                  status: await requestPermission(permission.type),
                }),
              );
            }}
          >
            <span className="kv-value">{t(permission.label)}</span>
            <span className="kv-key">{permission.type}</span>
          </button>
        ))}
      </div>

      <div className="log">
        {log.length === 0 ? (
          <span className="log-empty">{t("log.empty")}</span>
        ) : (
          log.map((line, index) => (
            <div className="log-row" key={`${line}-${index}`}>
              <span className="log-name">{line}</span>
            </div>
          ))
        )}
      </div>

      <div className="lede">
        <h2>{t("callbacks.title")}</h2>
        <p>
          {t("callbacks.lead")}
          <em>{t("callbacks.emphasis")}</em>
          {t("callbacks.body")}
        </p>
      </div>

      <button
        type="button"
        className="button"
        onClick={async () => {
          haptics.light();
          const result = await requestCallback("checkAccount");
          note(t("log.line", { name: "checkAccount", status: result.status }));
        }}
      >
        {t("callbacks.run")}
      </button>

      <p className="note">{t("callbacks.note")}</p>
    </main>
  );
}
