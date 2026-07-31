import type { PropsWithChildren } from "react";
import { useActions, useHaptics } from "superwall/hooks";
import "./theme.css";

export default function Layout({ children }: PropsWithChildren) {
  const { openUrl } = useActions();
  const haptics = useHaptics();

  return (
    <div className="flex min-h-dvh flex-col bg-bg font-sans text-fg antialiased">
      {children}
      <footer className="flex items-center justify-center gap-1.5 border-t border-fg/10 px-5 py-3.5 text-xs text-fg/50">
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
