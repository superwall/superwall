import { useHaptics, useTranslation } from "superwall/hooks";
import { useRouter, type RouteName, type Transition } from "superwall/navigation";

const TRANSITIONS: {
  route: RouteName;
  transition: Transition;
  name: string;
  tag?: string;
  blurb: string;
}[] = [
  {
    route: "push",
    transition: "push",
    name: "choices.push.name",
    tag: "choices.push.tag",
    blurb: "choices.push.blurb",
  },
  {
    route: "slide",
    transition: "slide",
    name: "choices.slide.name",
    blurb: "choices.slide.blurb",
  },
  {
    route: "fade",
    transition: "fade",
    name: "choices.fade.name",
    blurb: "choices.fade.blurb",
  },
  {
    route: "shift",
    transition: "shift",
    name: "choices.shift.name",
    tag: "choices.shift.tag",
    blurb: "choices.shift.blurb",
  },
  {
    route: "none",
    transition: "none",
    name: "choices.none.name",
    blurb: "choices.none.blurb",
  },
  {
    route: "zoom",
    transition: "zoom",
    name: "choices.zoom.name",
    blurb: "choices.zoom.blurb",
  },
];

export default function Index() {
  const router = useRouter();
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>{t("index.title")}</h1>
        <p>{t("index.subtitle")}</p>
      </div>

      <div className="choices">
        {TRANSITIONS.map((entry) => (
          <button
            key={entry.route}
            type="button"
            className="choice"
            onClick={() => {
              haptics.light();
              router.push(entry.route, { transition: entry.transition });
            }}
          >
            <span className="choice-head">
              <span className="choice-name">{t(entry.name)}</span>
              {entry.tag && <span className="choice-tag">({t(entry.tag)})</span>}
            </span>
            <span className="choice-blurb">{t(entry.blurb)}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
