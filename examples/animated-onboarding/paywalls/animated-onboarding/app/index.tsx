import { useHaptics, useSuperwallSnapshot, useTranslation } from "superwall/hooks";
import { IMAGE, IMAGE_SIZE } from "../components/flow";
import { useStoryRouter } from "../components/motion/useStoryRouter";

export default function Index() {
  const story = useStoryRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  /**
   * The cover's entrance keys off `paywall_open`, not off mount: the SDK
   * preloads surfaces in a hidden webview, so mount can happen long before
   * anyone is looking. Every later page enters by its hand-off, which only
   * runs on a tap, so only this one needs the gate.
   */
  const opened = useSuperwallSnapshot().paywall !== undefined;

  return (
    <main className="page page--cover" data-flow-page="" data-opened={opened ? "" : undefined}>
      <img className="hero" data-flow-image="" src={IMAGE.index} width={IMAGE_SIZE.width} height={IMAGE_SIZE.height} alt={t("index.imageAlt")} />

      <div className="lede">
        <h1 data-flow-line="">{t("index.title")}</h1>
        <p data-flow-line="">{t("index.subtitle")}</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          data-next-button=""
          onClick={() => {
            haptics.light();
            story.push("goal");
          }}
        >
          {t("index.cta")}
        </button>
      </div>
    </main>
  );
}
