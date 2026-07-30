import * as React from "react";
import { useActions, useHaptics } from "superwall/hooks";

const PERMISSIONS = [
  { type: "notification", label: "Notifications" },
  { type: "camera", label: "Camera" },
  { type: "microphone", label: "Microphone" },
  { type: "location", label: "Location" },
  { type: "background_location", label: "Location, always" },
  { type: "contacts", label: "Contacts" },
  { type: "read_images", label: "Photos" },
  { type: "read_video", label: "Videos" },
  { type: "tracking", label: "Tracking" },
] as const;

export default function Index() {
  const { requestPermission, requestCallback } = useActions();
  const haptics = useHaptics();
  const [log, setLog] = React.useState<string[]>([]);
  const note = (line: string) => setLog((all) => [line, ...all].slice(0, 6));

  return (
    <main className="page">
      <div className="lede">
        <h1>Permissions</h1>
        <p>Ask the app for something and wait for its answer.</p>
      </div>

      <div className="rows">
        {PERMISSIONS.map((permission) => (
          <button
            key={permission.type}
            type="button"
            className="kv kv--button"
            onClick={async () => {
              haptics.light();
              note(`${permission.type} → ${await requestPermission(permission.type)}`);
            }}
          >
            <span className="kv-value">{permission.label}</span>
            <span className="kv-key">{permission.type}</span>
          </button>
        ))}
      </div>

      <div className="log">
        {log.length === 0 ? (
          <span className="log-empty">Nothing asked yet.</span>
        ) : (
          log.map((line, index) => (
            <div className="log-row" key={`${line}-${index}`}>
              <span className="log-name">{line}</span>
            </div>
          ))
        )}
      </div>

      <div className="lede">
        <h2>Callbacks</h2>
        <p>
          A permission asks the OS. A callback asks <em>your app</em> — run some code, hand
          something back. Use it for anything the paywall cannot know: whether this account already
          exists, what the last workout was, whether a referral is valid.
        </p>
      </div>

      <button
        type="button"
        className="button"
        onClick={async () => {
          haptics.light();
          const result = await requestCallback("checkAccount");
          note(`checkAccount → ${result.status}`);
        }}
      >
        Run checkAccount
      </button>

      <p className="note">
        Both return a promise the app resolves, so the paywall is waiting on code you do not
        control. Give it something to look at, and handle a no.
      </p>
    </main>
  );
}
