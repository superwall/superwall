import type { PropsWithChildren } from "react";
import { useActions, useHaptics } from "superwall/hooks";
import "./theme.css";

export default function Layout({ children }: PropsWithChildren) {
  const { close, openUrl } = useActions();
  const haptics = useHaptics();

  return (
    <div className="shell">
      <button
        type="button"
        className="close"
        aria-label="Close"
        onClick={() => {
          haptics.light();
          close();
        }}
      >
        <svg
          viewBox="0 0 16 16"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 4 12 12M12 4 4 12" />
        </svg>
      </button>
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
