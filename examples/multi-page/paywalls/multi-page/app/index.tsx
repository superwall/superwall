import { useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Index() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page page--chromed">
      <div className="lede">
        <h1>Meet Pro</h1>
        <p>Three screens in one paywall. Every file in app/ is a screen.</p>
      </div>

      <pre className="tree">
        {"app/\n"}
        {"├── "}
        <b>index.tsx</b>
        {"     "}
        <i>you are here</i>
        {"\n├── "}
        <b>features.tsx</b>
        {"\n├── "}
        <b>plans.tsx</b>
        {"\n└── "}
        <b>layout.tsx</b>
        {"    the chrome above and below"}
      </pre>

      <p>
        The filename is the route name — <code>router.push("features")</code>. No config, no
        registry, and all three ship in one snapshot.
      </p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            router.push("features");
          }}
        >
          See what you get
        </button>
      </div>
    </main>
  );
}
