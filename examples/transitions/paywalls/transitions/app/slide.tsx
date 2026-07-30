import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "slide";

export default function Page() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>Slide</h1>
        <p>Both pages travel together. Best for steps of equal weight, like an onboarding flow.</p>
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
