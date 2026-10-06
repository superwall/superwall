import { useHaptics, useTranslation } from "superwall/hooks";
import { useStoryRouter } from "../components/motion/useStoryRouter";

/**
 * "flood": the chosen answer opens into this page's full-screen colour; the
 * words arrive on it once the colour has filled the screen (motion.css). The
 * layout inverts its chrome while this page is on top (data-tone="inverse").
 */
export const transition = "story-flood";

export default function Statement() {
  const story = useStoryRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <main className="page page--statement" data-flow-page="">
      <div className="backdrop" data-flow-backdrop="" aria-hidden="true" />

      <div className="lede lede--statement">
        <span className="eyebrow" data-flow-line="">
          {t("statement.eyebrow")}
        </span>
        <h1 data-flow-line="">{t("statement.title")}</h1>
        <p data-flow-line="">{t("statement.body")}</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          data-next-button=""
          onClick={() => {
            haptics.light();
            story.push("tried");
          }}
        >
          {t("statement.cta")}
        </button>
      </div>
    </main>
  );
}
