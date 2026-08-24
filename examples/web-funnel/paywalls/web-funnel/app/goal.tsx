import { useHaptics } from "superwall/hooks";
import { useQueryState, useRouter } from "superwall/navigation";
import { GOALS, goalParser } from "../components/goals";

export default function Goal() {
  const router = useRouter();
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
        Back
      </button>

      <div className="lede">
        <h1>What are you after?</h1>
        <p>The answer goes in the URL, so it survives a reload or a switch to another browser.</p>
      </div>

      <ul className="choices">
        {GOALS.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="choice"
              aria-pressed={goal === entry.id}
              onClick={() => {
                haptics.light();
                setGoal(entry.id);
                router.push("plan");
              }}
            >
              <span className="choice-label">{entry.label}</span>
              <span className="choice-hint">{entry.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
