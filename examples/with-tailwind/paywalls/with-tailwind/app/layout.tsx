import type { PropsWithChildren } from "react";
import { useActions, useHaptics, useTranslation } from "superwall/hooks";
import { Wordmark } from "../components/Wordmark";
import "./theme.css";

// Every control: no tap flash, press feedback on the finger, hover only for a real pointer.
const CONTROL =
  "cursor-pointer touch-manipulation select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] ease-out duration-200 active:duration-80";

export default function Layout({ children }: PropsWithChildren) {
  const { close, openUrl } = useActions();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <div className="flex flex-1 flex-col bg-bg font-sans text-base tracking-body text-fg antialiased select-none">
      {/* iOS close: a small circle at the top-right, 44px to the finger. */}
      <button
        type="button"
        aria-label={t("common.close")}
        className={`${CONTROL} absolute top-1 right-2.5 z-10 flex size-11 items-center justify-center rounded-full text-fg-tertiary transition-[transform,color] hover:text-fg active:scale-[0.92]`}
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
      <footer className="flex flex-none items-center justify-center gap-1.5 border-t border-border px-5 py-1 text-xs text-fg-tertiary">
        {t("footer.builtWith")}
        {/* The wordmark keeps its size; the invisible hit area reaches 44px. */}
        <button
          type="button"
          aria-label={t("footer.superwall")}
          className={`${CONTROL} relative flex min-h-11 items-center px-1 text-fg transition-transform [--logo-primary:var(--color-accent)] [--logo-secondary:var(--color-fg)] active:scale-[0.97]`}
          onClick={() => {
            haptics.light();
            openUrl("https://superwall.com");
          }}
        >
          <Wordmark />
        </button>
      </footer>
    </div>
  );
}
