import { useHaptics, useProducts, usePurchase } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "sheet";

export default function Offer() {
  const router = useRouter();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const discount = getProduct("discount");

  return (
    <main className="page">
      <div className="lede">
        <h1>Before you go</h1>
        <p>A second price, shown only to people who nearly bought.</p>
      </div>

      <p className="note">
        Arrives as a sheet from the bottom, a transition this project defines in CSS. Dismissing it
        plays the same movement in reverse.
      </p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase("discount");
          }}
        >
          {discount?.variables.price ? `Get it for ${discount.variables.price}` : "Take the offer"}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            router.back();
          }}
        >
          No thanks
        </button>
      </div>
    </main>
  );
}
