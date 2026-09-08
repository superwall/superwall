import { useHaptics, useProducts, usePurchase, useIntroductoryOffer } from "superwall/hooks";

export default function Index() {
  const { eligible } = useIntroductoryOffer();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const days = annual?.variables.trialPeriodDays;

  return (
    <main className="page">
      <div className="lede">
        <h1>{eligible ? "Start free" : "Go Pro"}</h1>
        <p>
          {eligible
            ? days
              ? `${days} days free, then ${annual?.variables.price ?? "the annual price"}.`
              : "Your trial is on the house."
            : "You have used your trial. Subscribe to keep going."}
        </p>
      </div>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">introductoryOffer.eligible</span>
          <span className="kv-value">{String(eligible)}</span>
        </div>
        <div className="kv">
          <span className="kv-key">trialPeriodDays</span>
          <span className="kv-value">{days ?? "—"}</span>
        </div>
      </div>

      <p className="note">
        The store decides who gets a trial, not you. Toggle Intro offer in the footer to see both.
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
          {eligible ? "Start free trial" : (annual?.variables.price ?? "Subscribe")}
        </button>
      </div>
    </main>
  );
}
