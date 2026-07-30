import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "fade";

export default function Page() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>Fade</h1>
        <p>The new page fades in over the old one, a little quicker than the others.</p>
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
