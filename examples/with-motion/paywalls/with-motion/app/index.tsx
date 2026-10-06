import * as React from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
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

/** The same curve the stylesheet's `--ease-out` token uses, so Motion and CSS move alike. */
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

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

  /**
   * Reduced motion is gentler, not none: the entrance becomes a cross-fade
   * (nothing travels), and the price still counts up — it is content, not
   * movement.
   */
  const reduced = useReducedMotion() === true;

  // One line of copy for an outcome worth saying; nothing for an abandoned sheet.
  const [notice, setNotice] = React.useState<string>();

  const annual = getProduct("annual");
  const formatted = annual?.variables.price;
  const rawPrice = Number(annual?.variables.rawPrice);
  const raw = Number.isFinite(rawPrice) ? rawPrice : undefined;
  const currency = annual?.variables.currencyCode;
  const locale = annual?.variables.locale;

  /**
   * The price counts up once the paywall is visible and the store priced it.
   * While it counts, the figure is formatted in the store's own currency and
   * locale; when it lands, the store's formatted `price` string replaces it,
   * so the number on screen is never one this page invented.
   */
  const price = useMotionValue(0);
  const [landed, setLanded] = React.useState(false);
  const format = React.useMemo(() => {
    try {
      return new Intl.NumberFormat(
        locale,
        currency
          ? { style: "currency", currency }
          : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
      );
    } catch {
      return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  }, [locale, currency]);
  const counting = useTransform(price, (value) => format.format(value));
  React.useEffect(() => {
    if (opened && raw !== undefined) {
      setLanded(false);
      const controls = animate(price, raw, {
        duration: 0.45,
        ease: EASE_OUT,
        onComplete: () => setLanded(true),
      });
      return () => controls.stop();
    }
  }, [opened, raw, price]);

  /**
   * Motion animates the full `transform` string rather than the `x` / `y`
   * shorthands: a string transform is handed to the compositor, while the
   * shorthands are composed on the main thread — the thread that is busy
   * pricing products and loading fonts exactly while the entrance plays.
   */
  const rise = reduced ? "translateY(0px)" : "translateY(12px)";
  const slide = reduced ? "translateX(0px)" : "translateX(-12px)";

  return (
    <main className="page">
      <motion.div
        className="lede"
        initial={{ opacity: 0, transform: rise }}
        animate={
          opened ? { opacity: 1, transform: "translateY(0px)" } : { opacity: 0, transform: rise }
        }
        transition={{ duration: 0.4, ease: EASE_OUT }}
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
            initial={{ opacity: 0, transform: slide }}
            animate={
              opened
                ? { opacity: 1, transform: "translateX(0px)" }
                : { opacity: 0, transform: slide }
            }
            transition={{ delay: 0.1 + index * 0.05, duration: 0.35, ease: EASE_OUT }}
          >
            {t(feature)}
          </motion.li>
        ))}
      </ul>

      {raw !== undefined && formatted && (
        <div className="price">
          {landed ? <span>{formatted}</span> : <motion.span>{counting}</motion.span>}
          <span className="price-period"> {t("paywall.perYear")}</span>
        </div>
      )}

      <div className="actions">
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            // Never a loading state here: the store sheet is the feedback and the SDK owns it.
            const result = await purchase("annual");
            if (result.status === "completed")
              haptics.success(); // the SDK dismisses (postPurchase)
            else if (result.status === "failed") setNotice(t("purchase.failed")); // iOS only; the button stays enabled
            // abandoned: the user closed the sheet — nothing changes, nothing is said
          }}
        >
          {formatted ? t("paywall.cta", { price: formatted }) : t("paywall.ctaBare")}
        </button>
        <button
          type="button"
          className="link"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            // "Nothing to restore" and a store error both resolve `failed`; the copy covers both.
            const result = await restore();
            if (result.status === "restored") haptics.success();
            setNotice(result.status === "restored" ? t("restore.restored") : t("restore.failed"));
          }}
        >
          {t("paywall.restore")}
        </button>
      </div>
    </main>
  );
}
