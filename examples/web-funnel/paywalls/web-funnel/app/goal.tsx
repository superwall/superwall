import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

const GOALS = [
  { id: "focus", label: "Focus", hint: "Fewer, longer sessions" },
  { id: "habit", label: "Build a habit", hint: "A little every day" },
  { id: "catch-up", label: "Catch up", hint: "Work through a backlog" },
];

export default function Goal() {
  const router = useRouter();
  const haptics = useHaptics();

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
        <p>Answers stay in the page — the router carries no state.</p>
      </div>

      <ul className="choices">
        {GOALS.map((goal) => (
          <li key={goal.id}>
            <button
              type="button"
              className="choice"
              onClick={() => {
                haptics.light();
                router.push("plan");
              }}
            >
              <span className="choice-label">{goal.label}</span>
              <span className="choice-hint">{goal.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
