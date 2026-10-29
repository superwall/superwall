import { useTranslation } from "superwall/hooks";

const HIGHLIGHTS = ["projects", "offline", "spaces", "history", "support", "themes"] as const;

export function Highlights() {
  const { t } = useTranslation();

  return (
    <section className="section" aria-labelledby="highlights">
      <div className="section-head">
        <h2 id="highlights">{t("paywall.highlights")}</h2>
        <span className="micro">{t("paywall.highlightsHint")}</span>
      </div>
      <ul className="carousel">
        {HIGHLIGHTS.map((id) => (
          <li key={id} className="card">
            <h3>{t(`highlights.${id}.title`)}</h3>
            <p>{t(`highlights.${id}.body`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
