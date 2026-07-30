import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "zoom";

export default function Page() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>Custom</h1>
        <p>This one is a page zoom, written in CSS by this example.</p>
        <p>
          Allows any custom CSS animation you write. We expose enter, recede, return and leave, so
          you control how pages enter and exit in both directions.
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
