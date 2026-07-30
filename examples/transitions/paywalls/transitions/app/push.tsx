import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "push";

export default function Page() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>Push</h1>
        <p>
          The native iOS push. Best for drilling into a detail, because back feels like returning.
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
