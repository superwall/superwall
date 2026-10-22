import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { useAnswers, type Goal } from "../components/answers";

export default function Page() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const { answers, save } = useAnswers();
  const chosen = answers.goal;

  // Saved before moving on, so closing on the next screen loses nothing. The
  // card turns teal on the same frame as the haptic: useUser() sees it at once.
  const choose = (value: Goal) => {
    haptics.selection();
    save("goal", value);
    router.push("level");
  };

  return (
    <main className="page">
      <span className="step">{t("quiz.step", { current: 1, total: 3 })}</span>

      <div className="lede">
        <h1>{t("goal.title")}</h1>
      </div>

      <div className="choices">
        <button
          type="button"
          className="choice"
          aria-pressed={chosen === "lose"}
          onClick={() => choose("lose")}
        >
          <span className="choice-name">{t("goal.lose.name")}</span>
          <span className="choice-hint">{t("goal.lose.hint")}</span>
        </button>
        <button
          type="button"
          className="choice"
          aria-pressed={chosen === "build"}
          onClick={() => choose("build")}
        >
          <span className="choice-name">{t("goal.build.name")}</span>
          <span className="choice-hint">{t("goal.build.hint")}</span>
        </button>
        <button
          type="button"
          className="choice"
          aria-pressed={chosen === "endure"}
          onClick={() => choose("endure")}
        >
          <span className="choice-name">{t("goal.endure.name")}</span>
          <span className="choice-hint">{t("goal.endure.hint")}</span>
        </button>
      </div>
    </main>
  );
}
