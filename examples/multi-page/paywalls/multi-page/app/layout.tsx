import type { PropsWithChildren } from "react";
import { useActions, useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { Wordmark } from "../components/Wordmark";
import "./theme.css";

const Chevron = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M12.5 4.5 7 10l5.5 5.5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Cross = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

const Chrome = () => {
  const router = useRouter();
  const { close } = useActions();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <header className="chrome">
      {router.canGoBack() ? (
        <button
          type="button"
          className="chrome-button"
          aria-label={t("chrome.back")}
          onClick={() => {
            haptics.light();
            router.back();
          }}
        >
          <Chevron />
        </button>
      ) : (
        <span className="chrome-button" aria-hidden="true" />
      )}
      <span className="step">{t("chrome.step", { current: router.depth + 1, total: 3 })}</span>
      <button
        type="button"
        className="chrome-button"
        aria-label={t("chrome.close")}
        onClick={() => {
          haptics.light();
          close();
        }}
      >
        <Cross />
      </button>
    </header>
  );
};

export default function Layout({ children }: PropsWithChildren) {
  const { openUrl } = useActions();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <div className="shell" style={{ position: "relative" }}>
      <Chrome />
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
