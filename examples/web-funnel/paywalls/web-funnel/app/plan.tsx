import * as React from "react";
import {
  useActions,
  useHaptics,
  useProducts,
  usePurchase,
  type ProductReference,
} from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Plan() {
  const router = useRouter();
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  // Typed against the config: naming a product this paywall does not declare
  // is a compile error, not an undefined price on someone's phone.
  const [reference, setReference] = React.useState<ProductReference>("monthly");
  const monthly = getProduct("monthly");
  const selected = getProduct(reference);

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
        <h1>Go Pro ☆</h1>
        <p>Payment happens right here — the sheet opens over this page.</p>
      </div>

      <div className="plans">
        {([{ id: "monthly", label: "Monthly", product: monthly }] as const).map((plan) => (
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
