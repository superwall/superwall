import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "none";

export default function Page() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>None</h1>
        <p>Transitions without any animations.</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            haptics.light();
            router.back();
          }}
        >
          Back
        </button>
      </div>
    </main>
  );
}
