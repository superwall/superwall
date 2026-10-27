import type { PropsWithChildren } from "react";
import { useActions, useHaptics, useTranslation } from "superwall/hooks";
import { Wordmark } from "../components/Wordmark";
import "./theme.css";

export default function Layout({ children }: PropsWithChildren) {
  const { openUrl } = useActions();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <div className="shell">
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
