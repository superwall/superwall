import * as React from "react";
import { useHaptics, useProducts, usePurchase, type ProductReference } from "superwall/hooks";
import { useQueryState, useRouter } from "superwall/navigation";
import { goalParser } from "../components/goals";

export default function Plan() {
  const router = useRouter();
  const { getProduct } = useProducts();
  const { purchase, prefetch } = usePurchase();
  const haptics = useHaptics();
  const [goal] = useQueryState("goal", goalParser);

  // Typed against the config: naming a product this paywall does not declare
  // is a compile error, not an undefined price on someone's phone.
  const [reference, setReference] = React.useState<ProductReference>("monthly");
  const monthly = getProduct("monthly");
  const pro = getProduct("pro");
  const selected = getProduct(reference);

  // Warm the checkout for the plan on screen: the session is fetched and
  // Stripe's sheet pre-renders hidden, so Subscribe opens it instantly.
  React.useEffect(() => {
    prefetch(reference);
  }, [prefetch, reference]);

  return (
    <main className="page">
      <button
        type="button"
        className="link link--back"
        onClick={() => {
          haptics.light();
          router.back();
        }}
      >
        Back
      </button>

      <div className="lede">
        <h1>Go Pro</h1>
        <p>
          {goal ? `A plan for ${goal.replace("-", " ")}. ` : ""}
          Payment happens right here — the sheet opens over this page.
        </p>
      </div>

      <div className="plans">
        {(
          [
            { id: "monthly", label: "Monthly", product: monthly },
            { id: "pro", label: "Pro", product: pro },
          ] as const
        ).map((plan) => (
          <button
            key={plan.id}
            type="button"
            className="plan"
            aria-pressed={reference === plan.id}
            onClick={() => {
              haptics.light();
              setReference(plan.id);
            }}
          >
            <span className="plan-label">{plan.label}</span>
            <span className="plan-price">{plan.product?.variables.price ?? "—"}</span>
          </button>
        ))}
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase(reference);
          }}
        >
          {selected?.variables.price ? `Subscribe · ${selected.variables.price}` : "Subscribe"}
        </button>
      </div>
    </main>
  );
}
