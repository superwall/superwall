import { useActions, useHaptics, useProducts, usePurchase } from "superwall/hooks";

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const monthly = getProduct("monthly");

  return (
    <main className="page">
      <div className="lede">
        <h1>Go Pro</h1>
        <p>Everything unlocked, cancel whenever you like.</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase("monthly");
          }}
        >
          {monthly?.variables.price ? `Subscribe · ${monthly.variables.price}` : "Subscribe"}
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
