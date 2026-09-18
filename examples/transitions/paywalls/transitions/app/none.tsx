import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "none";

export default function Page() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("pages.none.title")}</h1>
        <p>{t("pages.none.body")}</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            haptics.light();
            router.back();
          }}
        >
          {t("common.back")}
        </button>
      </div>
    </main>
  );
}
