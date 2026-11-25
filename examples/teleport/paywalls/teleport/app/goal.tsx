import * as React from "react";
import { useHaptics, usePurchase, useTeleport, useTranslation } from "superwall/hooks";
import { useQueryState, useRouter } from "superwall/navigation";
import { GOALS, goalParser } from "../components/goals";

export default function Goal() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [goal, setGoal] = useQueryState("goal", goalParser);
  const [returned, setReturned] = React.useState<{ offer?: unknown }>();
  const teleport = useTeleport({
    onOpen: () => setReturned(undefined),
    onReturnData: (data) => {
      console.log("[teleport] data from the page", data);
      setReturned(data);
    },
  });
  const failure = teleport.status === "waiting" ? teleport.failure : undefined;
  const offer =
    (teleport.status === "waiting" ? teleport.data?.offer : undefined) ?? returned?.offer;
  const failed = failure !== undefined || returned !== undefined;
  const { purchase } = usePurchase();

  return (
    <main className="page">
      <button
        type="button"
        className="link link--back"
        onClick={() => {
          haptics.light();
          router.back();
        }}
      >
        {t("common.back")}
      </button>

      <div className="lede">
        <h1>{t("goal.title")}</h1>
        <p>{t("goal.subtitle")}</p>
        {failed ? (
          <p className="notice" role="status">
            {offer === "app_store" ? t("back.noFunds") : t("back.failed")}
          </p>
        ) : null}
        {failed && offer === "app_store" ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              haptics.medium();
              void purchase("annual");
            }}
          >
            {t("back.appStore")}
          </button>
        ) : null}
      </div>

      <ul className="choices">
        {GOALS.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="choice"
              aria-pressed={goal === entry.id}
              onClick={() => {
                haptics.selection();
                setGoal(entry.id);
                // `plan` is the teleport route: in an iOS app this opens it in the browser.
                router.push("plan");
              }}
            >
              <span className="choice-label">{t(entry.label)}</span>
              <span className="choice-hint">{t(entry.hint)}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
