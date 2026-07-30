import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { answers, type Time } from "../components/answers";

export default function Page() {
  const router = useRouter();
  const haptics = useHaptics();

  const choose = (value: Time) => {
    haptics.selection();
    answers.time = value;
    router.push("plan");
  };

  return (
    <main className="page">
      <span className="step">Step 3 of 3</span>

      <div className="lede">
        <h1>How long have you got?</h1>
      </div>

      <div className="choices">
        <button type="button" className="choice" onClick={() => choose("15")}>
          <span className="choice-name">15 minutes</span>
          <span className="choice-hint">Most days, quickly</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("30")}>
          <span className="choice-name">30 minutes</span>
          <span className="choice-hint">The usual</span>
        </button>
        <button type="button" className="choice" onClick={() => choose("45")}>
          <span className="choice-name">45+ minutes</span>
          <span className="choice-hint">No rush</span>
        </button>
      </div>
    </main>
  );
}
