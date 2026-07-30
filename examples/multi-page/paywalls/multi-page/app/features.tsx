import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

const FEATURES = [
  "Unlimited projects",
  "Offline access",
  "Priority support",
  "Everything, forever",
];

export default function Features() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page page--chromed">
      <div className="lede">
        <h1>What you get</h1>
      </div>

      <ul className="features">
        {FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            router.push("plans");
          }}
        >
          Choose a plan
        </button>
      </div>
    </main>
  );
}
