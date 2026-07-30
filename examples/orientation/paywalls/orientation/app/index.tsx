import { useDevice, useHaptics, useProducts, usePurchase } from "superwall/hooks";

const FEATURES = ["Unlimited workouts", "Offline downloads", "Form checks", "Coaching"];

export default function Index() {
  const { orientation } = useDevice();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const landscape = orientation === "landscape";

  return (
    <main className={`page ${landscape ? "page--landscape" : ""}`}>
      <div className="lede">
        <h1>Go Pro</h1>
        <p>Rotate the device. Same paywall, a layout that suits the shape.</p>
      </div>

      <ul className="features">
        {FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>

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
        <span className="orientation">{orientation}</span>
      </div>
    </main>
  );
}
