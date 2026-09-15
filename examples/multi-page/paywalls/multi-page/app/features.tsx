import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";

const FEATURES = [
  "features.items.projects",
  "features.items.offline",
  "features.items.support",
  "features.items.forever",
];

export default function Features() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <main className="page page--chromed">
      <div className="lede">
        <h1>{t("features.title")}</h1>
      </div>

      <ul className="features">
        {FEATURES.map((feature) => (
          <li key={feature}>{t(feature)}</li>
        ))}
      </ul>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            router.push("plans");
          }}
        >
          {t("features.cta")}
        </button>
      </div>
    </main>
  );
}
