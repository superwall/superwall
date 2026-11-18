import { useMemo, useState } from "react";
import { useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import type { PurchaseCallbacks } from "superwall/hooks";
import { CheckoutForm, SCENARIOS, type Scenario } from "../components/CheckoutForm";
import { EventLog, type LoggedEvent } from "../components/EventLog";

const PLANS = [
  { reference: "trial", label: "plans.trial", note: "plans.trialNote" },
  { reference: "monthly", label: "plans.monthly", note: "plans.monthlyNote" },
] as const;

type PlanReference = (typeof PLANS)[number]["reference"];

type Source = LoggedEvent["source"];

/**
 * The five purchase callbacks, each writing a line to the event log. The
 * same set goes to `usePurchase` (every purchase on the paywall) and to
 * `<StripeCheckout>` (that form's purchases only), so the log shows which
 * of the two heard each event.
 */
const logging = (source: Source, log: (event: Omit<LoggedEvent, "id">) => void) =>
  ({
    onStart: (product) => log({ source, name: "onStart", product: product.reference }),
    onSubmit: (product) => log({ source, name: "onSubmit", product: product.reference }),
    onComplete: (product) => log({ source, name: "onComplete", product: product.reference }),
    onAbandon: (product) => log({ source, name: "onAbandon", product: product.reference }),
    onFailure: (failure) =>
      log({
        source,
        name: "onFailure",
        product: failure.product.reference,
        detail: failure.reason,
      }),
  }) satisfies PurchaseCallbacks;

export default function Index() {
  const { t } = useTranslation();
  const haptics = useHaptics();
  const { getProduct } = useProducts();
  const [selected, setSelected] = useState<PlanReference>("trial");
  const [scenario, setScenario] = useState<Scenario>("applePayLink");
  const [done, setDone] = useState(false);
  const [events, setEvents] = useState<LoggedEvent[]>([]);

  const log = useMemo(() => {
    let next = 0;
    return (event: Omit<LoggedEvent, "id">) => {
      next += 1;
      const id = next;
      setEvents((all) => [...all, { ...event, id }]);
    };
  }, []);

  const paywall = logging("paywall", log);
  usePurchase({
    ...paywall,
    onComplete: (product) => {
      paywall.onComplete(product);
      haptics.success();
      setDone(true);
    },
  });
  const form = useMemo(() => logging("form", log), [log]);

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
      </div>

      <div className="plans" role="radiogroup" aria-label={t("plans.label")}>
        {PLANS.map((plan) => (
          <button
            key={plan.reference}
            type="button"
            className="plan"
            role="radio"
            aria-checked={selected === plan.reference}
            onClick={() => {
              haptics.selection();
              setSelected(plan.reference);
            }}
          >
            <span className="plan-label">
              {t(plan.label)}
              <span className="plan-note">{t(plan.note)}</span>
            </span>
            <span className="plan-price">
              {getProduct(plan.reference)?.variables.price ?? t("plans.empty")}
            </span>
          </button>
        ))}
      </div>

      <div className="scenarios" role="radiogroup" aria-label={t("scenarios.label")}>
        {SCENARIOS.map((name) => (
          <button
            key={name}
            type="button"
            className="scenario"
            role="radio"
            aria-checked={scenario === name}
            onClick={() => {
              haptics.selection();
              setScenario(name);
            }}
          >
            {t(`scenarios.${name}`)}
          </button>
        ))}
      </div>
      <p className="scenario-about">{t(`scenarios.about.${scenario}`)}</p>

      {done ? (
        <p className="notice" role="status">
          {t("purchase.completed")}
        </p>
      ) : (
        <CheckoutForm product={selected} scenario={scenario} callbacks={form} />
      )}

      <EventLog events={events} onClear={() => setEvents([])} />
    </main>
  );
}
