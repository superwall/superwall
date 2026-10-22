import { useHaptics, useTranslation, useUser, useUserAttribute } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { next, questionsFor, LEVEL, type Level } from "../components/answers";

const OPTIONS: readonly Level[] = ["new", "returning", "regular"];

export default function Page() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const user = useUser();
  const [chosen, setChosen] = useUserAttribute(LEVEL.key, LEVEL.parser);
  const questions = questionsFor(user);

  const choose = (value: Level) => {
    haptics.selection();
    setChosen(value);
    const to = next("level", { ...user, [LEVEL.key]: value });
    if (to) router.push(to);
  };

  return (
    <main className="page">
      <span className="step">
        {t("quiz.step", { current: questions.indexOf("level") + 1, total: questions.length })}
      </span>

      <div className="lede">
        <h1>{t("level.title")}</h1>
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
            <span className="choice-name">{t(`level.${option}.name`)}</span>
            <span className="choice-hint">{t(`level.${option}.hint`)}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
