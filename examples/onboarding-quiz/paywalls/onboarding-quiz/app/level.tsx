import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { answers, type Level } from "../components/answers";

export default function Page() {
  const router = useRouter();
  const haptics = useHaptics();

  const choose = (value: Level) => {
    haptics.selection();
    answers.level = value;
    router.push("time");
  };

  return (
    <main className="page">
      <span className="step">Step 2 of 3</span>

      <div className="lede">
        <h1>Where are you starting?</h1>
      </div>

      <div className="choices">
        <button type="button" className="choice" onClick={() => choose("new")}>
          <span className="choice-name">New to this</span>
          <span className="choice-hint">Never trained properly</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("returning")}>
          <span className="choice-name">Coming back</span>
          <span className="choice-hint">Been off for a while</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("regular")}>
          <span className="choice-name">Already training</span>
          <span className="choice-hint">Two or more times a week</span>
        </button>
      </div>
    </main>
  );
}
