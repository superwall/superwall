import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "shift";

export default function Page() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>Shift</h1>
        <p>
          The funnel step. The new page fades in as it drifts into place; the old one is simply
          gone. One layer moves at a time, so a long flow never feels like a stack.
        </p>
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
