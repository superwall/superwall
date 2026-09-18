import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { answers, type Time } from "../components/answers";

export default function Page() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const choose = (value: Time) => {
    haptics.selection();
    answers.time = value;
    router.push("plan");
  };

  return (
    <main className="page">
      <span className="step">{t("quiz.step", { current: 3, total: 3 })}</span>

      <div className="lede">
        <h1>{t("time.title")}</h1>
      </div>

      <div className="choices">
        <button type="button" className="choice" onClick={() => choose("15")}>
          <span className="choice-name">{t("time.15.name")}</span>
          <span className="choice-hint">{t("time.15.hint")}</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("30")}>
          <span className="choice-name">{t("time.30.name")}</span>
          <span className="choice-hint">{t("time.30.hint")}</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("45")}>
          <span className="choice-name">{t("time.45.name")}</span>
          <span className="choice-hint">{t("time.45.hint")}</span>
        </button>
      </div>
    </main>
  );
}
