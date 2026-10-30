import { useTranslation } from "superwall/hooks";

const FEATURES = [
  "sync",
  "export",
  "folders",
  "search",
  "reminders",
  "widgets",
  "lock",
  "shortcuts",
  "dark",
  "templates",
  "comments",
  "links",
  "backups",
  "import",
] as const;

const QUESTIONS = ["cancel", "devices", "stop"] as const;

export function FeatureList() {
  const { t } = useTranslation();

  return (
    <section className="section" aria-labelledby="features">
      <h2 id="features">{t("paywall.features")}</h2>
      <ul className="features">
        {FEATURES.map((id) => (
          <li key={id}>{t(`features.${id}`)}</li>
        ))}
      </ul>
    </section>
  );
}

export function Questions() {
  const { t } = useTranslation();

  return (
    <section className="section" aria-labelledby="faq">
      <h2 id="faq">{t("paywall.faq")}</h2>
      <dl className="faq">
        {QUESTIONS.map((id) => (
          <div key={id}>
            <dt>{t(`faq.${id}.question`)}</dt>
            <dd>{t(`faq.${id}.answer`)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
