import { useVariables } from "superwall/hooks";
export default function Index() {
  const { device, user, params } = useVariables();

  const name = typeof user.firstName === "string" ? user.firstName : undefined;

  return (
    <main className="page">
      <div className="lede">
        <h1>{name ? `Welcome back, ${name}` : "Go Pro"}</h1>
        <p>What the SDK knows about who is looking. Use it to change the copy.</p>
      </div>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">device.platform</span>
          <span className="kv-value">{device.platform ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="kv-key">device.locale</span>
          <span className="kv-value">{device.locale ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="kv-key">user.firstName</span>
          <span className="kv-value">{name ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="kv-key">params.placementName</span>
          <span className="kv-value">
            {typeof params.placementName === "string" ? params.placementName : "—"}
          </span>
        </div>
      </div>

      <p className="note">
        Edit any of these in the Variables panel. On device <code>user</code> comes from{" "}
        <code>setUserAttributes</code> and <code>params</code> from the placement.
      </p>
    </main>
  );
}
