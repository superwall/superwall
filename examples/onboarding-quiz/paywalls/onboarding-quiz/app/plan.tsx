import { useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { answers, PLAN } from "../components/answers";

const LEVEL: Record<string, string> = {
  new: "plan.level.new",
  returning: "plan.level.returning",
  regular: "plan.level.regular",
};

export default function Plan() {
  const router = useRouter();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const price = annual?.variables.price;
  const plan = answers.goal ? PLAN[answers.goal] : undefined;

  return (
    <main className="page">
      <div className="lede">
        <span className="step">{t("plan.eyebrow")}</span>
        <h1>{plan ? t(plan.title) : t("plan.titleFallback")}</h1>
        <p>{plan && t(plan.blurb)}</p>
      </div>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">{t("plan.startingPoint")}</span>
          <span className="kv-value">
            {answers.level ? t(LEVEL[answers.level]) : t("plan.empty")}
          </span>
        </div>
        <div className="kv">
          <span className="kv-key">{t("plan.perSession")}</span>
          <span className="kv-value">
            {answers.time ? t("plan.minutes", { minutes: answers.time }) : t("plan.empty")}
          </span>
        </div>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase("annual");
          }}
        >
          {price ? t("plan.cta", { price }) : t("plan.ctaBare")}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            router.dismissAll();
          }}
        >
          {t("plan.startOver")}
        </button>
      </div>
    </main>
  );
}
