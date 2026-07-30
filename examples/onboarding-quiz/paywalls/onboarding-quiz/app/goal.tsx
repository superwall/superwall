import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { answers, type Goal } from "../components/answers";

export default function Page() {
  const router = useRouter();
  const haptics = useHaptics();

  const choose = (value: Goal) => {
    haptics.selection();
    answers.goal = value;
    router.push("level");
  };

  return (
    <main className="page">
      <span className="step">Step 1 of 3</span>

      <div className="lede">
        <h1>What are you here for?</h1>
      </div>

      <div className="choices">
        <button type="button" className="choice" onClick={() => choose("lose")}>
          <span className="choice-name">Lose fat</span>
          <span className="choice-hint">Down a size, keep the strength</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("build")}>
          <span className="choice-name">Build muscle</span>
          <span className="choice-hint">Heavier, thicker, stronger</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("endure")}>
          <span className="choice-name">Go further</span>
          <span className="choice-hint">Runs, rides, long days</span>
        </button>
      </div>
    </main>
  );
}
