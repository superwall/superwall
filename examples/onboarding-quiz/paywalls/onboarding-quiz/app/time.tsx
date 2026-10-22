import { useHaptics, useTranslation, useUser, useUserAttribute } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { next, questionsFor, TIME, type Time } from "../components/answers";

const OPTIONS: readonly Time[] = ["15", "30", "45"];

export default function Page() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const user = useUser();
  const [chosen, setChosen] = useUserAttribute(TIME.key, TIME.parser);
  const questions = questionsFor(user);

  const choose = (value: Time) => {
    haptics.selection();
    setChosen(value);
    const to = next("time", { ...user, [TIME.key]: value });
    if (to) router.push(to);
  };

  return (
    <main className="page">
      <span className="step">
        {t("quiz.step", { current: questions.indexOf("time") + 1, total: questions.length })}
      </span>

      <div className="lede">
        <h1>{t("time.title")}</h1>
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
            <span className="choice-name">{t(`time.${option}.name`)}</span>
            <span className="choice-hint">{t(`time.${option}.hint`)}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
