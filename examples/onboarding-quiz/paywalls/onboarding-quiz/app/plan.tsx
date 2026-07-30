import { useHaptics, useProducts, usePurchase } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { answers, PLAN } from "../components/answers";

const LEVEL: Record<string, string> = {
  new: "Starting from scratch",
  returning: "Getting back into it",
  regular: "Already training",
};

export default function Plan() {
  const router = useRouter();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const haptics = useHaptics();

  const annual = getProduct("annual");
  const plan = answers.goal ? PLAN[answers.goal] : undefined;

  return (
    <main className="page">
      <div className="lede">
        <span className="step">Your plan</span>
        <h1>{plan?.title ?? "Your plan"}</h1>
        <p>{plan?.blurb}</p>
      </div>

      <div className="rows">
        <div className="kv">
          <span className="kv-key">Starting point</span>
          <span className="kv-value">{answers.level ? LEVEL[answers.level] : "—"}</span>
        </div>
        <div className="kv">
          <span className="kv-key">Per session</span>
          <span className="kv-value">{answers.time ? `${answers.time} minutes` : "—"}</span>
        </div>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            purchase("annual");
          }}
        >
          {annual?.variables.price ? `Start · ${annual.variables.price}` : "Start"}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.light();
            router.dismissAll();
          }}
        >
          Start over
        </button>
      </div>
    </main>
  );
}
