import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Index() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("index.title")}</h1>
        <p>{t("index.subtitle")}</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            router.push("goal");
          }}
        >
          {t("index.cta")}
        </button>
      </div>
    </main>
  );
}
