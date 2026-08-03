import * as React from "react";
import { useActions, useHaptics, useProducts, usePurchase } from "superwall/hooks";
import { PlanOption } from "../components/PlanOption";

const PLANS = ["annual", "monthly"] as const;

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const [selected, setSelected] = React.useState<(typeof PLANS)[number]>("annual");
  const priced = PLANS.some((reference) => getProduct(reference)?.variables.price);

  return (
    <main className="page">
      <div className="lede">
        <h1>Go Pro</h1>
        <p>Pick a plan. Cancel whenever you like.</p>
      </div>

      <div className="plans" role="radiogroup" aria-label="Plans">
        {PLANS.map((reference) => {
          const product = getProduct(reference);
          const monthly = product?.variables.monthlyPrice;
          return (
            <PlanOption
              key={reference}
              name={reference === "annual" ? "Annual" : "Monthly"}
              badge={reference === "annual" ? "Best value" : undefined}
              price={product?.variables.price}
              caption={reference === "annual" && monthly ? `${monthly}/mo` : undefined}
              selected={selected === reference}
              onSelect={() => {
                haptics.selection();
                setSelected(reference);
              }}
            />
          );
        })}
      </div>

      {!priced && (
        <p className="note">
          No prices yet. They come from your Superwall account, never from this file — point{" "}
          <code>config.ts</code> at products in your dashboard and they appear here and on device.
        </p>
      )}

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase(selected);
          }}
        >
          Continue
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            restore();
          }}
        >
          Restore purchases
        </button>
      </div>
    </main>
  );
}
