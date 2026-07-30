import type { PropsWithChildren } from "react";
import { useActions, useHaptics } from "superwall/hooks";
import "./theme.css";

export default function Layout({ children }: PropsWithChildren) {
  const { openUrl } = useActions();
  const haptics = useHaptics();

  return (
    <div className="shell">
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
