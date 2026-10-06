import { useHaptics, useTranslation } from "superwall/hooks";
import { useQueryState, useRouter } from "superwall/navigation";
import { GOALS, goalParser } from "../components/goals";

export default function Goal() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [goal, setGoal] = useQueryState("goal", goalParser);

  return (
    <main className="page">
      <button
        type="button"
        className="link link--back"
        onClick={() => {
          haptics.light();
          router.back();
        }}
      >
        {t("common.back")}
      </button>

      <div className="lede">
        <h1>{t("goal.title")}</h1>
        <p>{t("goal.subtitle")}</p>
      </div>

      <ul className="choices">
        {GOALS.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="choice"
              aria-pressed={goal === entry.id}
              onClick={() => {
                haptics.selection();
                setGoal(entry.id);
                router.push("plan");
              }}
            >
              <span className="choice-label">{t(entry.label)}</span>
              <span className="choice-hint">{t(entry.hint)}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
