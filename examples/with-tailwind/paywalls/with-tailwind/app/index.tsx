import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";

const FEATURES = [
  "paywall.features.projects",
  "paywall.features.stats",
  "paywall.features.support",
];

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const annual = getProduct("annual");

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col gap-6 px-5 pt-4 pb-6">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-4xl font-medium tracking-tight">{t("paywall.title")}</h1>
        <p className="text-fg/70">{t("paywall.subtitle")}</p>
      </div>

      <ul className="flex flex-col border border-fg/10">
        {FEATURES.map((feature) => (
          <li key={feature} className="border-b border-fg/10 px-4 py-3.5 last:border-b-0">
            {t(feature)}
          </li>
        ))}
      </ul>

      <div className="border-l-2 border-accent bg-accent/10 px-3.5 py-3 text-[0.8125rem] text-fg/70">
        {t("paywall.noteBefore")} <code className="font-mono text-fg">dark:</code>{" "}
        {t("paywall.noteMiddle")} <code className="font-mono text-fg">&lt;html&gt;</code>
        {t("paywall.noteAfter")}
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-5">
        <button
          type="button"
          className="flex min-h-11 w-full cursor-pointer items-center justify-center bg-fg font-medium text-bg hover:bg-fg/85"
          onClick={() => {
            haptics.light();
            purchase("annual");
          }}
        >
          {annual?.variables.price
            ? t("paywall.cta", { price: annual.variables.price })
            : t("paywall.ctaBare")}
        </button>
        <button
          type="button"
          className="cursor-pointer self-center p-2 text-[0.8125rem] text-fg/55 hover:text-fg"
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
