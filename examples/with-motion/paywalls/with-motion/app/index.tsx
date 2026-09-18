import * as React from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import {
  useActions,
  useHaptics,
  useProducts,
  usePurchase,
  useSuperwallSnapshot,
  useTranslation,
} from "superwall/hooks";

const FEATURES = [
  "paywall.features.projects",
  "paywall.features.stats",
  "paywall.features.support",
  "paywall.features.early",
];

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
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
  const shown = useTransform(price, (value) => (raw === undefined ? "" : `$${value.toFixed(2)}`));
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
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
      </motion.div>

      <p className="note">
        {t("paywall.noteBefore")} <code>paywall_open</code> {t("paywall.noteAfter")}
      </p>

      <ul className="features">
        {FEATURES.map((feature, index) => (
          <motion.li
            key={feature}
            initial={{ opacity: 0, x: -12 }}
            animate={opened ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
            transition={{ delay: 0.15 + index * 0.08, duration: 0.35, ease: "easeOut" }}
          >
            {t(feature)}
          </motion.li>
        ))}
      </ul>

      {raw !== undefined && (
        <div className="price">
          <motion.span>{shown}</motion.span>
          <span className="price-period"> {t("paywall.perYear")}</span>
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
          {t("paywall.cta")}
        </motion.button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            restore();
          }}
        >
          {t("paywall.restore")}
        </button>
      </div>
    </main>
  );
}
