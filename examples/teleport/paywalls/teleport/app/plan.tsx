import * as React from "react";
import { useHaptics, useProducts, usePurchase, useTeleport, useTranslation } from "superwall/hooks";
import { parseAsStringEnum, useQueryState, useRouter } from "superwall/navigation";
import { GOALS, goalParser } from "../components/goals";

// This page is the teleport route: in an iOS app it opens in the shopper's
// browser, with the goal from the app already set. The plan lives in the URL
// too, so a reload lands back on the plan that was picked.
const planParser = parseAsStringEnum(["monthly", "pro"]).withDefault("monthly");

export default function Plan() {
  const router = useRouter();
  const { getProduct } = useProducts();
  const teleport = useTeleport();
  const { purchase, prefetch } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [goal] = useQueryState("goal", goalParser);
  const [notice, setNotice] = React.useState<string>();

  // Typed against the config: naming a product this paywall does not declare
  // is a compile error, not an undefined price on someone's phone.
  const [reference, setReference] = useQueryState("plan", planParser);
  const monthly = getProduct("monthly");
  const pro = getProduct("pro");
  const selected = getProduct(reference);
  const chosen = GOALS.find((entry) => entry.id === goal);

  // Warm the checkout for the plan on screen, so Subscribe opens it at once.
  React.useEffect(() => {
    prefetch(reference);
  }, [prefetch, reference]);

  return (
    <main className="page">
      {/* On the web page, Back on this route returns to the app. */}
      <button
        type="button"
        className="link link--back"
        onClick={() => {
          haptics.light();
          router.back();
        }}
      >
        {t("common.back")}
      </button>

      <div className="lede">
        <h1>{t("plan.title")}</h1>
        <p>
          {chosen ? `${t("plan.forGoal", { goal: t(chosen.phrase) })} ` : ""}
          {t("plan.body")}
        </p>
        {teleport.status === "arrived" ? <p className="notice">{t("plan.fromApp")}</p> : null}
      </div>

      <div className="plans">
        {(
          [
            { id: "monthly", label: "plan.monthly", product: monthly },
            { id: "pro", label: "plan.pro", product: pro },
          ] as const
        ).map((plan) => (
          <button
            key={plan.id}
            type="button"
            className="plan"
            aria-pressed={reference === plan.id}
            onClick={() => {
              haptics.selection();
              setReference(plan.id);
            }}
          >
            <span className="plan-label">{t(plan.label)}</span>
            <span className="plan-price">{plan.product?.variables.price ?? t("plan.empty")}</span>
          </button>
        ))}
      </div>

      <div className="actions">
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        {/* purchase() resolves completed | abandoned | failed; the button never shows a loading state — the sheet is the feedback. */}
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            const result = await purchase(reference);
            if (result.status === "completed") haptics.success();
            else if (result.status === "failed") setNotice(t("plan.failed"));
            // abandoned: the sheet was closed — nothing changes, nothing is said
          }}
        >
          {selected?.variables.price
            ? t("plan.cta", { price: selected.variables.price })
            : t("plan.ctaBare")}
        </button>
      </div>
    </main>
  );
}
