import type { PropsWithChildren } from "react";
import { useActions, useHaptics } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import "./theme.css";

const Chrome = () => {
  const router = useRouter();
  const { close } = useActions();
  const haptics = useHaptics();

  return (
    <header className="chrome">
      {router.canGoBack() ? (
        <button
          type="button"
          className="chrome-button"
          onClick={() => {
            haptics.light();
            router.back();
          }}
        >
          Back
        </button>
      ) : (
        <span className="chrome-button" />
      )}
      <span className="step">
        {router.depth + 1} of {3}
      </span>
      <button
        type="button"
        className="chrome-button"
        style={{ textAlign: "right" }}
        onClick={close}
      >
        Close
      </button>
    </header>
  );
};

export default function Layout({ children }: PropsWithChildren) {
  const { openUrl } = useActions();
  const haptics = useHaptics();

  return (
    <div className="shell" style={{ position: "relative" }}>
      <Chrome />
      {children}
      <footer className="built">
        Built with
        <button
          type="button"
          className="wordmark"
          aria-label="Superwall"
          onClick={() => {
            haptics.light();
            openUrl("https://superwall.com");
          }}
        >
          <span className="wordmark-accent">$UPER</span>WALL
        </button>
      </footer>
    </div>
  );
}
