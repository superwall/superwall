import * as React from "react";
import { useActions, useHaptics, useProducts, usePurchase, useTranslation } from "superwall/hooks";
import { RiveArt } from "../components/RiveArt";
import smiley from "../assets/smiley-switch.riv";
import stars from "../assets/star-rating.riv";
import water from "../assets/water-bar.riv";

export default function Index() {
  const { restore } = useActions();
  const { getProduct } = useProducts();
  const { purchase } = usePurchase();
  const { t } = useTranslation();
  const haptics = useHaptics();

  // One line of copy for an outcome worth saying; nothing for an abandoned sheet.
  const [notice, setNotice] = React.useState<string>();

  const annual = getProduct("annual");
  const price = annual?.variables.price;

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
        ratio="16 / 9"
        onChange={() => haptics.light()}
      />

      <RiveArt
        src={stars}
        title={t("art.rating.title")}
        hint={t("art.rating.hint")}
        stateMachine="State Machine 1"
        control="self"
        ratio="21 / 9"
      />

      <RiveArt
        src={water}
        title={t("art.level.title")}
        hint={t("art.level.hint")}
        stateMachine="State Machine"
        input="Level"
        control="slider"
        ratio="4 / 3"
        onChange={() => haptics.selection()}
      />

      <p className="note">{t("paywall.note")}</p>

      <div className="actions">
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            // Never a loading state: the store sheet is the feedback and the SDK owns it.
            const result = await purchase("annual");
            if (result.status === "completed") haptics.success(); // the SDK dismisses the paywall
            else if (result.status === "failed") setNotice(t("purchase.failed")); // iOS only; the button stays enabled
            // abandoned: the user closed the sheet — nothing changes, nothing is said
          }}
        >
          {price ? t("paywall.cta", { price }) : t("paywall.ctaBare")}
        </button>
        <button
          type="button"
          className="link"
          onClick={async () => {
            haptics.light();
            setNotice(undefined);
            // "Nothing to restore" and a store error both resolve `failed`; the copy covers both.
            const result = await restore();
            if (result.status === "restored") haptics.success();
            setNotice(result.status === "restored" ? t("restore.restored") : t("restore.failed"));
          }}
        >
          {t("paywall.restore")}
        </button>
      </div>
    </main>
  );
}
