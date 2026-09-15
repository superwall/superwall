import type { PropsWithChildren } from "react";
import { useActions, useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import "./theme.css";

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
          onClick={() => {
            haptics.light();
            router.back();
          }}
        >
          {t("chrome.back")}
        </button>
      ) : (
        <span className="chrome-button" />
      )}
      <span className="step">{t("chrome.step", { current: router.depth + 1, total: 3 })}</span>
      <button
        type="button"
        className="chrome-button"
        style={{ textAlign: "right" }}
        onClick={close}
      >
        {t("chrome.close")}
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
          <span className="wordmark-accent">$UPER</span>WALL
        </button>
      </footer>
    </div>
  );
}
