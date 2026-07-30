import { useActions, useHaptics, useProducts, usePurchase } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Plans() {
  const router = useRouter();
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const annual = getProduct("annual");

  return (
    <main className="page page--chromed">
      <div className="lede">
        <h1>Go annual</h1>
        {annual?.variables.monthlyPrice && (
          <p>{annual.variables.monthlyPrice} a month, billed annually.</p>
        )}
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase("annual");
          }}
        >
          {annual?.variables.price ? `Subscribe · ${annual.variables.price}` : "Subscribe"}
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
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            router.dismissAll();
          }}
        >
          Start over
        </button>
      </div>
    </main>
  );
}
