import type { PropsWithChildren } from "react";
import { useActions, useHaptics } from "superwall/hooks";
import "./theme.css";

export default function Layout({ children }: PropsWithChildren) {
  const { close, openUrl } = useActions();
  const haptics = useHaptics();

  return (
    <div className="flex min-h-dvh flex-col bg-bg pt-[calc(40px+env(safe-area-inset-top))] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] font-sans text-fg antialiased">
      <div className="mx-auto flex w-full max-w-2xl justify-end px-5 pt-7">
        <button
          type="button"
          aria-label="Close"
          className="flex size-8 cursor-pointer items-center justify-center text-xl text-fg/55 hover:text-fg"
          onClick={() => {
            haptics.light();
            close();
          }}
        >
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 4 12 12M12 4 4 12" />
          </svg>
        </button>
      </div>
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
