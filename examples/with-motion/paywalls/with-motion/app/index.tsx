import * as React from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import {
  useActions,
  useHaptics,
  useProducts,
  usePurchase,
  useSuperwallSnapshot,
} from "superwall/hooks";

const FEATURES = ["Unlimited projects", "Advanced stats", "Priority support", "Early features"];

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  /**
   * Entry animations key off the `paywall_open` event, not off mount. The SDK
   * preloads paywalls in a hidden webview, so mount can happen long before
   * anyone is looking — animating then means the show is over by the time the
   * paywall is presented. `snapshot.paywall` is set when `paywall_open`
   * arrives, and unlike an event subscription it cannot be missed.
   */
  const opened = useSuperwallSnapshot().paywall !== undefined;

  const annual = getProduct("annual");
  const rawPrice = Number(annual?.variables.rawPrice);
  const raw = Number.isFinite(rawPrice) ? rawPrice : undefined;

  /** The price counts up once the paywall is visible and the store priced it. */
  const price = useMotionValue(0);
  const shown = useTransform(price, (value) =>
    raw === undefined ? "" : `$${value.toFixed(2)}`,
  );
  React.useEffect(() => {
    if (opened && raw !== undefined) {
      const controls = animate(price, raw, { duration: 0.9, ease: "circOut" });
      return () => controls.stop();
    }
  }, [opened, raw, price]);

  return (
    <main className="page">
      <motion.div
        className="lede"
        initial={{ opacity: 0, y: 14 }}
        animate={opened ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <h1>Go Pro</h1>
        <p>Animated with Motion — the list staggers in, the button reacts to touch.</p>
      </motion.div>

      <p className="note">
        These animations start on the <code>paywall_open</code> event rather than on mount —
        paywalls preload hidden, so a mount-timed animation has already played by the time anyone
        sees the page.
      </p>

      <ul className="features">
        {FEATURES.map((feature, index) => (
          <motion.li
            key={feature}
            initial={{ opacity: 0, x: -12 }}
            animate={opened ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
            transition={{ delay: 0.15 + index * 0.08, duration: 0.35, ease: "easeOut" }}
          >
            {feature}
          </motion.li>
        ))}
      </ul>

      {raw !== undefined && (
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
