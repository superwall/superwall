import { useHaptics, useProducts, usePurchase } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Index() {
  const router = useRouter();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const annual = getProduct("annual");

  return (
    <main className="page">
      <div className="lede">
        <h1>Go Pro</h1>
        <p>Close the store sheet without buying and see what happens.</p>
      </div>

      <p className="note">
        Most people who open a store sheet close it. Catching that is worth more than anything else
        on this page.
      </p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            const result = await purchase("annual");
            if (result.status === "abandoned") {
              router.push("offer", { transition: "sheet" });
            }
          }}
        >
          {annual?.variables.price ? `Subscribe · ${annual.variables.price}` : "Subscribe"}
        </button>
      </div>
    </main>
  );
}
