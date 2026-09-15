import { useHaptics, useTranslation } from "superwall/hooks";
import { RiveArt } from "../components/RiveArt";
import smiley from "../assets/smiley-switch.riv";
import stars from "../assets/star-rating.riv";
import water from "../assets/water-bar.riv";

export default function Index() {
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("paywall.title")}</h1>
        <p>{t("paywall.subtitle")}</p>
      </div>

      <RiveArt
        src={smiley}
        title={t("art.switch.title")}
        hint={t("art.switch.hint")}
        stateMachine="Remember Start SM"
        input="Toggle"
        control="tap"
        height={200}
        onChange={() => haptics.light()}
      />

      <RiveArt
        src={stars}
        title={t("art.rating.title")}
        hint={t("art.rating.hint")}
        stateMachine="State Machine 1"
        control="self"
        height={150}
      />

      <RiveArt
        src={water}
        title={t("art.level.title")}
        hint={t("art.level.hint")}
        stateMachine="State Machine"
        input="Level"
        control="slider"
        height={260}
        onChange={() => haptics.selection()}
      />

      <p className="note">{t("paywall.note")}</p>
    </main>
  );
}
