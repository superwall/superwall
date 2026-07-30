import * as React from "react";
import { useHaptics, useProducts, usePurchase, useSuperwallEvent } from "superwall/hooks";

export default function Index() {
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
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
        <h1>Try it free</h1>
        <p>
          {days ? `${days} days, then it renews.` : "Free for a while, then it renews."} We remind
          them the day before.
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
          <span className="kv-key">reminder</span>
          <span className="kv-value">{scheduled ? "scheduled" : "on trial start"}</span>
        </div>
        <div className="kv">
          <span className="kv-key">fires</span>
          <span className="kv-value">1 day before it ends</span>
        </div>
      </div>

      <p className="note">
        Declared in <code>config.ts</code>, scheduled by the SDK when the trial starts. The paywall
        does not have to be open when it fires.
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
          {days ? `Start ${days}-day trial` : "Start free trial"}
        </button>
      </div>
    </main>
  );
}
