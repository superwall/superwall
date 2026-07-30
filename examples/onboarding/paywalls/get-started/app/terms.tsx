import { useRouter } from "superwall/navigation";
import { useActions, useTranslation } from "superwall/hooks";

export default function Terms() {
  const router = useRouter();
  const { t } = useTranslation();
  const { openExternalUrl } = useActions();

  return (
    <main className="screen">
      <h1 className="title">{t("terms.title")}</h1>
      <p className="body">{t("terms.body")}</p>

      <button
        type="button"
        className="link"
        onClick={() => openExternalUrl("https://superwall.com/terms")}
      >
        {t("terms.full")}
      </button>

      <button type="button" className="primary" onClick={() => router.dismissAll()}>
        {t("terms.restart")}
      </button>
    </main>
  );
}
