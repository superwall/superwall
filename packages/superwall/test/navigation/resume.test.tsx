import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { useActions, useUser } from "../../src/hooks";
import {
  PaywallRouter,
  TRANSITION_MS,
  useRouter,
  type Entry,
  type RouteMap,
} from "../../src/navigation/index";
import { SuperwallProvider } from "../../src/provider/context";
import { createHost, flush, testConfig } from "../helpers";

type PageView = Extract<TOutgoingMessage, { event_name: "page_view" }>;
type User = Record<string, unknown>;

const QUESTIONS = [
  {
    route: "goal",
    attribute: "onboarding_goal",
    options: ["lose", "build", "endure"],
    next: "level",
  },
  {
    route: "level",
    attribute: "onboarding_level",
    options: ["new", "returning", "regular"],
    next: "time",
  },
  { route: "time", attribute: "onboarding_time", options: ["15", "30", "45"], next: "plan" },
] as const;

const resumeStack: Entry = ({ user }) => {
  const unanswered = QUESTIONS.findIndex(
    ({ attribute, options }) => !options.some((option) => option === user[attribute]),
  );
  if (unanswered === 0) return ["index"];
  if (unanswered === -1) return ["index", ...QUESTIONS.map(({ route }) => route), "plan"];
  return ["index", ...QUESTIONS.slice(0, unanswered + 1).map(({ route }) => route)];
};

let mounts: string[] = [];

const useMounted = (name: string) =>
  React.useLayoutEffect(() => {
    mounts.push(name);
  }, [name]);

const Intro = () => {
  const router = useRouter();
  useMounted("index");
  return (
    <main>
      <h1>intro</h1>
      <button type="button" onClick={() => router.push("goal")}>
        begin
      </button>
    </main>
  );
};

const question = ({ route, attribute, options, next }: (typeof QUESTIONS)[number]) =>
  function Question() {
    const router = useRouter();
    const user = useUser();
    const { setUserAttributes } = useActions();
    useMounted(route);
    return (
      <main>
        <h1>{route}</h1>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={user[attribute] === option}
            onClick={() => {
              setUserAttributes({ [attribute]: option });
              router.push(next);
            }}
          >
            {route}:{option}
          </button>
        ))}
      </main>
    );
  };

const Plan = () => {
  useMounted("plan");
  return <h1>plan</h1>;
};

const Layout = ({ children }: React.PropsWithChildren) => {
  const router = useRouter();
  return (
    <div>
      {router.canGoBack() ? (
        <button type="button" aria-label="back" onClick={() => router.back()} />
      ) : null}
      <button type="button" onClick={() => router.dismissAll()}>
        start over
      </button>
      {children}
    </div>
  );
};

const routes: RouteMap = {
  index: { default: Intro },
  goal: { default: question(QUESTIONS[0]) },
  level: { default: question(QUESTIONS[1]) },
  time: { default: question(QUESTIONS[2]) },
  plan: { default: Plan },
};

const launch = async (user: User = {}) => {
  mounts = [];
  const outgoing: TOutgoingMessage[] = [];
  const { transport, host } = createHost({
    user,
    onOutgoing: (message) => outgoing.push(message),
  });
  const { unmount } = render(
    <SuperwallProvider config={testConfig} transport={transport}>
      <PaywallRouter routes={routes} Layout={Layout} entry={resumeStack} navigationId="quiz" />
    </SuperwallProvider>,
  );
  await flush();
  return {
    pageViews: () =>
      outgoing.filter((message): message is PageView => message.event_name === "page_view"),
    persisted: () => ({ ...host.state.user }),
    kill: () => unmount(),
  };
};

const layer = (name: string) => document.querySelector<HTMLElement>(`[data-sw-route="${name}"]`);
const layerAttribute = (name: string, key: string) => layer(name)?.getAttribute(key) ?? null;
const routesOnStack = () =>
  [...document.querySelectorAll<HTMLElement>("[data-sw-route]")].map((el) => [
    el.dataset.swRoute,
    el.dataset.swState,
  ]);
const active = () =>
  document.querySelector<HTMLElement>('[data-sw-state="active"]')?.dataset.swRoute;
const selected = () =>
  [...(layer(active() ?? "")?.querySelectorAll('[aria-pressed="true"]') ?? [])].map(
    (button) => button.textContent,
  );
const backButton = () => screen.queryByRole("button", { name: "back" });
const settle = () => act(() => vi.advanceTimersByTime(TRANSITION_MS));

const TWO_ANSWERED = { onboarding_goal: "build", onboarding_level: "returning" };
const ALL_ANSWERED = { ...TWO_ANSWERED, onboarding_time: "30" };

beforeEach(() => {
  window.history.replaceState({}, "", "/?transport=editor");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a relaunched onboarding resumes where the last process left off", () => {
  it("opens on the first unanswered question, settled, with every answered one under it", async () => {
    const { pageViews } = await launch(TWO_ANSWERED);

    expect(routesOnStack()).toEqual([
      ["index", "below"],
      ["goal", "below"],
      ["level", "behind"],
      ["time", "active"],
    ]);
    expect(mounts).toEqual(["index", "goal", "level", "time"]);
    expect(layerAttribute("time", "data-sw-settled")).toBe("");
    for (const name of ["index", "goal", "level", "time"]) {
      expect(layerAttribute(name, "data-sw-phase")).toBeNull();
    }
    expect(layer("time")?.hasAttribute("inert")).toBe(false);
    expect(layer("level")?.hasAttribute("inert")).toBe(true);
    expect(selected()).toEqual([]);
    expect(pageViews()).toEqual([
      expect.objectContaining({ type: "entry", page_name: "time", flow_position: 3 }),
    ]);
  });

  it("shows back on the resumed page and walks every answered question, answer selected, down to the intro", async () => {
    const { pageViews } = await launch(TWO_ANSWERED);
    vi.useFakeTimers();
    expect(backButton()).not.toBeNull();

    const steps = [
      { from: "time", to: "level", answer: "level:returning" },
      { from: "level", to: "goal", answer: "goal:build" },
      { from: "goal", to: "index", answer: undefined },
    ];
    for (const { from, to, answer } of steps) {
      fireEvent.click(backButton()!);
      expect(layerAttribute(from, "data-sw-state")).toBe("exiting");
      expect(layerAttribute(from, "data-sw-phase")).toBe("leave");
      expect(layerAttribute(to, "data-sw-phase")).toBe("return");
      expect(layerAttribute(to, "data-sw-direction")).toBe("back");
      expect(layerAttribute(to, "data-sw-transition")).toBe("push");
      settle();
      expect(layer(from)).toBeNull();
      expect(active()).toBe(to);
      expect(layerAttribute(to, "data-sw-settled")).toBe("");
      expect(selected()).toEqual(answer ? [answer] : []);
    }
    expect(backButton()).toBeNull();
    expect(pageViews().map((view) => [view.type, view.page_name])).toEqual([
      ["entry", "time"],
      ["back", "level"],
      ["back", "goal"],
      ["back", "index"],
    ]);
  });

  it("starts over from the resumed page onto the intro", async () => {
    await launch(ALL_ANSWERED);
    vi.useFakeTimers();
    expect(active()).toBe("plan");

    fireEvent.click(screen.getByText("start over"));
    expect(layerAttribute("plan", "data-sw-phase")).toBe("leave");
    expect(layerAttribute("index", "data-sw-phase")).toBe("return");
    settle();

    expect(routesOnStack()).toEqual([["index", "active"]]);
    expect(backButton()).toBeNull();
  });

  it("answers forward from the resumed page, saving the answer and pushing the next one", async () => {
    const { persisted, pageViews } = await launch(TWO_ANSWERED);
    vi.useFakeTimers();

    fireEvent.click(screen.getByText("time:30"));
    expect(persisted()).toEqual(ALL_ANSWERED);
    expect(layerAttribute("plan", "data-sw-phase")).toBe("enter");
    expect(layerAttribute("time", "data-sw-phase")).toBe("recede");
    settle();

    expect(active()).toBe("plan");
    expect(pageViews().at(-1)).toEqual(
      expect.objectContaining({ type: "forward", page_name: "plan", flow_position: 4 }),
    );
  });

  it("resumes one page further after each quit, from answers the paywall itself saved", async () => {
    const first = await launch();
    vi.useFakeTimers();
    expect(routesOnStack()).toEqual([["index", "active"]]);
    fireEvent.click(screen.getByText("begin"));
    settle();
    fireEvent.click(screen.getByText("goal:build"));
    settle();
    fireEvent.click(screen.getByText("level:returning"));
    settle();
    expect(active()).toBe("time");
    const afterFirst = first.persisted();
    expect(afterFirst).toEqual(TWO_ANSWERED);
    first.kill();
    vi.useRealTimers();

    const second = await launch(afterFirst);
    expect(active()).toBe("time");
    expect(mounts).toEqual(["index", "goal", "level", "time"]);
    vi.useFakeTimers();
    fireEvent.click(screen.getByText("time:30"));
    settle();
    const afterSecond = second.persisted();
    expect(afterSecond).toEqual(ALL_ANSWERED);
    second.kill();
    vi.useRealTimers();

    const third = await launch(afterSecond);
    expect(routesOnStack()).toEqual([
      ["index", "below"],
      ["goal", "below"],
      ["level", "below"],
      ["time", "behind"],
      ["plan", "active"],
    ]);
    expect(layerAttribute("plan", "data-sw-settled")).toBe("");
    expect(third.pageViews()).toEqual([
      expect.objectContaining({ type: "entry", page_name: "plan", flow_position: 4 }),
    ]);
    vi.useFakeTimers();
    fireEvent.click(backButton()!);
    settle();
    expect(active()).toBe("time");
    expect(selected()).toEqual(["time:30"]);
  });
});
