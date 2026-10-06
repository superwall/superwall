import * as React from "react";
import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";

const FEATURES = [
  "paywall.features.projects",
  "paywall.features.stats",
  "paywall.features.support",
];

// Every control: a 3px corner, no tap flash, press feedback on the finger, hover only for a real pointer.
const CONTROL =
  "cursor-pointer rounded-sm touch-manipulation select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] ease-out duration-200 active:duration-80";

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  // One line of copy for an outcome worth saying; nothing for an abandoned sheet.
  const [notice, setNotice] = React.useState<string>();

  const annual = getProduct("annual");
  const price = annual?.variables.price;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col gap-6 px-5 pt-4">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-display font-medium text-balance">{t("paywall.title")}</h1>
        <p className="text-fg-secondary">{t("paywall.subtitle")}</p>
      </div>

      <ul className="flex flex-col rounded-sm border border-border">
        {FEATURES.map((feature) => (
          <li key={feature} className="border-b border-border px-4 py-3.5 last:border-b-0">
            {t(feature)}
          </li>
        ))}
      </ul>

      <div className="rounded-r-sm border-l-2 border-accent bg-surface px-3.5 py-3 text-xs text-fg-secondary">
        {t("paywall.noteBefore")} <code className="font-mono text-fg">dark:</code>{" "}
        {t("paywall.noteMiddle")} <code className="font-mono text-fg">&lt;html&gt;</code>
        {t("paywall.noteAfter")}
      </div>

      {/* The primary action is pinned: the page scrolls under it, the content fades out behind it. */}
      <div className="sticky bottom-0 mt-auto flex flex-col gap-2 bg-[linear-gradient(to_bottom,transparent,var(--color-bg)_20px)] pt-5 pb-4">
        {notice ? (
          <p
            role="status"
            className="wrap-anywhere text-center text-xs text-fg-tertiary select-text"
          >
            {notice}
          </p>
        ) : null}
        <button
          type="button"
          className={`${CONTROL} flex min-h-13 w-full items-center justify-center border border-accent bg-accent px-4 text-base font-medium text-accent-ink tabular-nums transition-[transform,background-color,border-color] hover:border-accent-hover hover:bg-accent-hover active:scale-[0.97]`}
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            // Never a loading state: the store sheet is the feedback and the SDK owns it.
            const result = await purchase("annual");
            if (result.status === "completed")
              haptics.success(); // the SDK dismisses the paywall
            else if (result.status === "failed") setNotice(t("purchase.failed")); // iOS only; the button stays enabled
            // abandoned: the user closed the sheet — nothing changes, nothing is said
          }}
        >
          {price ? t("paywall.cta", { price }) : t("paywall.ctaBare")}
        </button>
        <button
          type="button"
          className={`${CONTROL} min-h-11 self-center px-3 py-2 text-xs text-fg-tertiary transition-[transform,color] hover:text-fg active:scale-[0.97]`}
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
