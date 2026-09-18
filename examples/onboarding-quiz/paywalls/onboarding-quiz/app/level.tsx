import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { answers, type Level } from "../components/answers";

export default function Page() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const choose = (value: Level) => {
    haptics.selection();
    answers.level = value;
    router.push("time");
  };

  return (
    <main className="page">
      <span className="step">{t("quiz.step", { current: 2, total: 3 })}</span>

      <div className="lede">
        <h1>{t("level.title")}</h1>
      </div>

      <div className="choices">
        <button type="button" className="choice" onClick={() => choose("new")}>
          <span className="choice-name">{t("level.new.name")}</span>
          <span className="choice-hint">{t("level.new.hint")}</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("returning")}>
          <span className="choice-name">{t("level.returning.name")}</span>
          <span className="choice-hint">{t("level.returning.hint")}</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("regular")}>
          <span className="choice-name">{t("level.regular.name")}</span>
          <span className="choice-hint">{t("level.regular.hint")}</span>
        </button>
      </div>
    </main>
  );
}
