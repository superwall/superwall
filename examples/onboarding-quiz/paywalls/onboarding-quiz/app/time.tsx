import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { useAnswers, type Time } from "../components/answers";

export default function Page() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  const { answers, save } = useAnswers();
  const chosen = answers.time;

  // Saved before moving on, so closing on the next screen loses nothing. The
  // card turns teal on the same frame as the haptic: useUser() sees it at once.
  const choose = (value: Time) => {
    haptics.selection();
    save("time", value);
    router.push("plan");
  };

  return (
    <main className="page">
      <span className="step">{t("quiz.step", { current: 3, total: 3 })}</span>

      <div className="lede">
        <h1>{t("time.title")}</h1>
      </div>

      <div className="choices">
        <button
          type="button"
          className="choice"
          aria-pressed={chosen === "15"}
          onClick={() => choose("15")}
        >
          <span className="choice-name">{t("time.15.name")}</span>
          <span className="choice-hint">{t("time.15.hint")}</span>
        </button>
        <button
          type="button"
          className="choice"
          aria-pressed={chosen === "30"}
          onClick={() => choose("30")}
        >
          <span className="choice-name">{t("time.30.name")}</span>
          <span className="choice-hint">{t("time.30.hint")}</span>
        </button>
        <button
          type="button"
          className="choice"
          aria-pressed={chosen === "45"}
          onClick={() => choose("45")}
        >
          <span className="choice-name">{t("time.45.name")}</span>
          <span className="choice-hint">{t("time.45.hint")}</span>
        </button>
      </div>
    </main>
  );
}
