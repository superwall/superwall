import * as React from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useActions, useHaptics, useProducts, usePurchase } from "superwall/hooks";

const FEATURES = ["Unlimited projects", "Advanced stats", "Priority support", "Early features"];

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const raw = annual?.variables.rawPrice;

  /** The price counts up to its real value once the store delivers it. */
  const price = useMotionValue(0);
  const shown = useTransform(price, (value) =>
    typeof raw === "number" ? `$${value.toFixed(2)}` : "",
  );
  React.useEffect(() => {
    if (typeof raw === "number") {
      const controls = animate(price, raw, { duration: 0.9, ease: "circOut" });
      return () => controls.stop();
    }
  }, [raw, price]);

  return (
    <main className="page">
      <motion.div
        className="lede"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <h1>Go Pro</h1>
        <p>Animated with Motion — the list staggers in, the button reacts to touch.</p>
      </motion.div>

      <ul className="features">
        {FEATURES.map((feature, index) => (
          <motion.li
            key={feature}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + index * 0.08, duration: 0.35, ease: "easeOut" }}
          >
            {feature}
          </motion.li>
        ))}
      </ul>

      {typeof raw === "number" && (
        <div className="price">
          <motion.span>{shown}</motion.span>
          <span className="price-period"> / year</span>
        </div>
      )}

      <div className="actions">
        <motion.button
          type="button"
          className="button button--primary"
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            haptics.light();
            purchase("annual");
          }}
        >
          Subscribe
        </motion.button>
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
