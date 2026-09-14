import type { PropsWithChildren } from "react";
import { useActions, useHaptics } from "superwall/hooks";
import "./theme.css";

export default function Layout({ children }: PropsWithChildren) {
  const { close, openUrl } = useActions();
  const haptics = useHaptics();

  return (
    <div className="flex flex-1 flex-col bg-bg font-sans text-fg antialiased">
      <button
        type="button"
        aria-label="Close"
        className="absolute top-1 right-4 z-10 flex size-8 cursor-pointer items-center justify-center text-xl text-fg/55 hover:text-fg"
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
      <footer className="flex items-center justify-center gap-1.5 border-t border-fg/10 px-5 pt-3.5 pb-3.5 text-xs text-fg/50">
        Built with
        <button
          type="button"
          aria-label="Superwall"
          className="cursor-pointer font-semibold text-fg"
          onClick={() => {
            haptics.light();
            openUrl("https://superwall.com");
          }}
        >
          <span className="text-accent">$UPER</span>WALL
        </button>
      </footer>
    </div>
  );
}
