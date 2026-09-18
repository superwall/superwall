import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

export default function Index() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <main className="page page--chromed">
      <div className="lede">
        <h1>{t("index.title")}</h1>
        <p>{t("index.subtitle")}</p>
      </div>

      <pre className="tree">
        {"app/\n"}
        {"├── "}
        <b>index.tsx</b>
        {"     "}
        <i>{t("index.tree.here")}</i>
        {"\n├── "}
        <b>features.tsx</b>
        {"\n├── "}
        <b>plans.tsx</b>
        {"\n└── "}
        <b>layout.tsx</b>
        {"    "}
        {t("index.tree.layout")}
      </pre>

      <p>
        {t("index.route.before")} <code>router.push("features")</code>
        {t("index.route.after")}
      </p>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            router.push("features");
          }}
        >
          {t("index.cta")}
        </button>
      </div>
    </main>
  );
}
