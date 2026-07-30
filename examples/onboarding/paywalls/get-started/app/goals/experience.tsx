import { useRouter } from "superwall/navigation";
import { useHaptics, useTranslation } from "superwall/hooks";
import { Choice } from "../../components/Choice";
import { useAnswers, type ExperienceLevel } from "../../components/Answers";

const LEVELS: ExperienceLevel[] = ["new", "returning", "seasoned"];

export default function Experience() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [answers, answer] = useAnswers();

  return (
    <main className="screen">
      <h1 className="title">{t("experience.title")}</h1>

      <div className="choices">
        {LEVELS.map((experience) => (
          <Choice
            key={experience}
            label={t(`experience.${experience}`)}
            selected={answers.experience === experience}
            onSelect={() => {
              haptics.selection();
              answer({ experience });
            }}
          />
        ))}
      </div>

      <label className="slider">
        <span>{t("experience.days", { days: answers.daysPerWeek })}</span>
        <input
          type="range"
          min={1}
          max={7}
          value={answers.daysPerWeek}
          onChange={(event) => answer({ daysPerWeek: Number(event.target.value) })}
        />
      </label>

      <button
        type="button"
        className="primary"
        disabled={!answers.experience}
        onClick={() => router.push("plans")}
      >
        {t("experience.continue")}
      </button>
    </main>
  );
}
