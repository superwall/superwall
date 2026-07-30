import { useRouter } from "superwall/navigation";
import { useTranslation } from "superwall/hooks";
import { resolveVariables } from "superwall/config";
import config from "../config";

export default function Index() {
  const router = useRouter();
  const { t } = useTranslation();
  const { skippableOnboarding } = resolveVariables(config.variables);

  return (
    <main className="screen screen-centered">
      <h1 className="title">{t("welcome.title")}</h1>
      <p className="subtitle">{t("welcome.subtitle")}</p>

      <div className="actions">
        <button type="button" className="primary" onClick={() => router.push("goals")}>
          {t("welcome.start")}
        </button>
        {skippableOnboarding ? (
          <button type="button" className="ghost" onClick={() => router.push("plans")}>
            {t("welcome.skip")}
          </button>
        ) : null}
      </div>
    </main>
  );
}
