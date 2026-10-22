import type { PropsWithChildren } from "react";
import { useActions, useHaptics, useTranslation } from "superwall/hooks";
import { replayStack, useRouter, type Entry } from "superwall/navigation";
import { answered, next } from "../components/answers";
import { Wordmark } from "../components/Wordmark";
import "./theme.css";

export const entry: Entry = ({ user }) =>
  replayStack(
    "index",
    (route) => next(route, user),
    (route) => answered(route, user),
  );

export default function Layout({ children }: PropsWithChildren) {
  const { close, openUrl } = useActions();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const router = useRouter();

  return (
    <div className="shell">
      {router.canGoBack() ? (
        <button
          type="button"
          className="back"
          aria-label={t("common.back")}
          onClick={() => {
            haptics.light();
            router.back();
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
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 3 5 8l5 5" />
          </svg>
        </button>
      ) : null}
      <button
        type="button"
        className="close"
        aria-label={t("common.close")}
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
        {t("footer.builtWith")}
        <button
          type="button"
          className="wordmark"
          aria-label={t("footer.superwall")}
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
