import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export const transition = "zoom";

export default function Page() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("pages.zoom.title")}</h1>
        <p>{t("pages.zoom.body")}</p>
        <p>{t("pages.zoom.detail")}</p>
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
