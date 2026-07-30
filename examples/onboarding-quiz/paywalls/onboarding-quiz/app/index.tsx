import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Index() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>Let's build your plan</h1>
        <p>Three questions. Takes about twenty seconds.</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            router.push("goal");
          }}
        >
          Get started
        </button>
      </div>
    </main>
  );
}
