import { useHaptics, useTranslation } from "superwall/hooks";
import { IMAGE, IMAGE_SIZE } from "../components/flow";
import { useStoryRouter } from "../components/motion/useStoryRouter";

/** "picture": the chosen answer opens into this page's photo; the copy rises beneath it. */
export const transition = "story-picture";

export default function Insight() {
  const story = useStoryRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <main className="page" data-flow-page="">
      <img
        className="hero"
        data-flow-image=""
        src={IMAGE.insight}
        width={IMAGE_SIZE.width}
        height={IMAGE_SIZE.height}
        alt={t("insight.imageAlt")}
      />

      <div className="lede">
        <span className="eyebrow" data-flow-line="">
          {t("insight.eyebrow")}
        </span>
        <h1 data-flow-line="">{t("insight.title")}</h1>
        <p data-flow-line="">{t("insight.body")}</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          data-next-button=""
          onClick={() => {
            haptics.light();
            story.push("done");
          }}
        >
          {t("insight.cta")}
        </button>
      </div>
    </main>
  );
}
