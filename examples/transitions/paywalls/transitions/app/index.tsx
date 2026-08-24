import { useHaptics } from "superwall/hooks";
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
    name: "Push",
    tag: "Default",
    blurb: "The native iOS push.",
  },
  { route: "slide", transition: "slide", name: "Slide", blurb: "Both pages travel together." },
  {
    route: "fade",
    transition: "fade",
    name: "Fade",
    blurb: "The new page fades in over the old one.",
  },
  {
    route: "shift",
    transition: "shift",
    name: "Shift",
    tag: "Funnels",
    blurb: "The new page fades in as it drifts into place.",
  },
  { route: "none", transition: "none", name: "None", blurb: "No animation at all." },
  {
    route: "zoom",
    transition: "zoom",
    name: "Custom",
    blurb: "Any CSS animation you write yourself.",
  },
];

export default function Index() {
  const router = useRouter();
  const haptics = useHaptics();

  return (
    <main className="page">
      <div className="lede">
        <h1>Transitions</h1>
        <p>
          Multi-page paywalls move between pages with a transition. Five are built in, and you can
          define your own in CSS.
        </p>
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
              <span className="choice-name">{entry.name}</span>
              {entry.tag && <span className="choice-tag">({entry.tag})</span>}
            </span>
            <span className="choice-blurb">{entry.blurb}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
