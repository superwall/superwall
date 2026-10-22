import { useLayoutEffect } from "react";
import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter } from "superwall/navigation";
import { resumeStack, useAnswers } from "../components/answers";

export default function Index() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();
  const { answers } = useAnswers();

  // Once, on opening: the host's attributes are in before the first render, and
  // a layout effect lands on the resumed screen before anything paints.
  useLayoutEffect(() => router.reset(resumeStack(answers)), []);

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("index.title")}</h1>
        <p>{t("index.subtitle")}</p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            haptics.light();
            router.push("goal");
          }}
        >
          {t("index.cta")}
        </button>
      </div>
    </main>
  );
}
