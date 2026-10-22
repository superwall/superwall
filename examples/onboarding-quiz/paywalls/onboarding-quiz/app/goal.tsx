import { useHaptics, useTranslation, useUser, useUserAttribute } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { next, questionsFor, GOAL, type Goal } from "../components/answers";

const OPTIONS: readonly Goal[] = ["lose", "build", "endure"];

export default function Page() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const user = useUser();
  const [chosen, setChosen] = useUserAttribute(GOAL.key, GOAL.parser);
  const questions = questionsFor(user);

  const choose = (value: Goal) => {
    haptics.selection();
    setChosen(value);
    const to = next("goal", { ...user, [GOAL.key]: value });
    if (to) router.push(to);
  };

  return (
    <main className="page">
      <span className="step">
        {t("quiz.step", { current: questions.indexOf("goal") + 1, total: questions.length })}
      </span>

      <div className="lede">
        <h1>{t("goal.title")}</h1>
      </div>

      <div className="choices">
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className="choice"
            aria-pressed={chosen === option}
            onClick={() => choose(option)}
          >
            <span className="choice-name">{t(`goal.${option}.name`)}</span>
            <span className="choice-hint">{t(`goal.${option}.hint`)}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
