import { useRouter } from "superwall/navigation";
import { useTranslation } from "superwall/hooks";
import { Choice } from "../../components/Choice";
import { useAnswers, type Goal } from "../../components/Answers";

const GOALS: Goal[] = ["lose", "build", "endure"];

export default function Goals() {
  const router = useRouter();
  const { t } = useTranslation();
  const [answers, answer] = useAnswers();

  return (
    <main className="screen">
      <h1 className="title">{t("goals.title")}</h1>

      <div className="choices">
        {GOALS.map((goal) => (
          <Choice
            key={goal}
            label={t(`goals.${goal}`)}
            selected={answers.goal === goal}
            onSelect={() => {
              answer({ goal });
              router.push("goals/experience");
            }}
          />
        ))}
      </div>
    </main>
  );
}
