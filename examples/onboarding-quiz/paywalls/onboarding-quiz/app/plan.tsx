import { useState } from "react";
import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { answers, PLAN } from "../components/answers";

const LEVEL: Record<string, string> = {
  new: "plan.level.new",
  returning: "plan.level.returning",
  regular: "plan.level.regular",
};

export default function Plan() {
  const router = useRouter();
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  // One line of copy for an outcome worth saying; nothing for an abandoned sheet.
  const [notice, setNotice] = useState<string>();

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
            // Never a loading state: the store sheet is the feedback and the SDK owns it.
            const result = await purchase("annual");
            if (result.status === "completed")
              haptics.success(); // the SDK dismisses the paywall
            else if (result.status === "failed") setNotice(t("purchase.failed")); // iOS only; the button stays enabled
            // abandoned: the user closed the sheet — nothing changes, nothing is said
          }}
        >
          {price ? t("plan.cta", { price }) : t("plan.ctaBare")}
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
          {t("plan.restore")}
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
