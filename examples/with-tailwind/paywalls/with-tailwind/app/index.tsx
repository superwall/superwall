import { useActions, useHaptics, useProducts, usePurchase } from "superwall/hooks";

const FEATURES = ["Unlimited projects", "Advanced stats", "Priority support"];

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const annual = getProduct("annual");

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col gap-6 px-5 pt-[calc(var(--safe-top)+16px)] pb-6">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-4xl font-medium tracking-tight">Go Pro</h1>
        <p className="text-fg/70">This paywall is styled with Tailwind.</p>
      </div>

      <ul className="flex flex-col border border-fg/10">
        {FEATURES.map((feature) => (
          <li key={feature} className="border-b border-fg/10 px-4 py-3.5 last:border-b-0">
            {feature}
          </li>
        ))}
      </ul>

      <div className="border-l-2 border-accent bg-accent/10 px-3.5 py-3 text-[0.8125rem] text-fg/70">
        Dark mode is the <code className="font-mono text-fg">dark:</code> variant, driven by the
        class the SDK already puts on <code className="font-mono text-fg">&lt;html&gt;</code>.
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
          {annual?.variables.price ? `Subscribe · ${annual.variables.price}` : "Subscribe"}
        </button>
        <button
          type="button"
          className="cursor-pointer self-center p-2 text-[0.8125rem] text-fg/55 hover:text-fg"
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
