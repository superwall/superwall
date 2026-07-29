import { useState } from "react";
import { resolveVariables } from "superwall/config";
import { useActions, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { SparkleIcon } from "@/components/SparkleIcon";
import { FeatureTable } from "../components/FeatureTable";
import { PlanToggle } from "../components/PlanToggle";
import config from "../config";
import hero from "../assets/hero.jpg";
import promo from "../assets/promo.mp4";
import "./styles.css";

type Plan = "go" | "plus";

const FEATURES = [
  { key: "coreModel", free: true },
  { key: "advancedModels", free: false },
  { key: "moreMessages", free: false },
  { key: "imageCreation", free: false },
  { key: "memory", free: false },
  { key: "codex", free: false },
] as const;

export default function PlusUpgrade() {
  const variables = resolveVariables(config.variables);
  const { getProduct } = useProducts();
  const { purchase, isPurchasing } = usePurchase();
  const { close, openUrl } = useActions();
  const { t } = useTranslation();
  const [plan, setPlan] = useState<Plan>(variables.defaultPlan);

  const product = getProduct(plan);
  const planLabel = t(`plans.${plan}`);

  return (
    <main className="paywall">
      <button type="button" className="close" aria-label="Close" onClick={() => close()}>
        ✕
      </button>

      <header className="hero">
        <SparkleIcon />
        <h1>{t("paywall.title", { plan: planLabel })}</h1>
        <p>{t("paywall.subtitle")}</p>
      </header>

      <figure className="showcase">
        <img className="showcase-still" src={hero} alt="" width={900} height={600} />
        <video
          className="showcase-clip"
          src={promo}
          poster={hero}
          muted
          loop
          playsInline
          autoPlay
        />
      </figure>

      <PlanToggle
        plans={[
          { id: "go", label: t("plans.go") },
          { id: "plus", label: t("plans.plus") },
        ]}
        selected={plan}
        onSelect={setPlan}
      />

      <FeatureTable
        featuresLabel={t("paywall.features")}
        freeLabel={t("paywall.free")}
        planLabel={planLabel}
        rows={FEATURES.map((feature) => ({
          label: t(`features.${feature.key}`),
          free: feature.free,
        }))}
      />

      <footer className="footer">
        <button
          type="button"
          className="cta"
          disabled={isPurchasing}
          onClick={async () => {
            const result = await purchase(plan);
            if (result.status === "completed") close();
          }}
        >
          {isPurchasing ? "…" : t("paywall.cta", { price: product?.variables.price ?? "" })}
        </button>

        {variables.showWebCheckout ? (
          <button
            type="button"
            className="web-link"
            onClick={() => openUrl("https://chatgpt.com/upgrade", { browserType: "payment_sheet" })}
          >
            {t("paywall.web")} <span aria-hidden="true">↗</span>
          </button>
        ) : null}

        <p className="footnote">{t("common.footnote")}</p>
      </footer>
    </main>
  );
}
