import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import {
  parseAsStringEnum,
  readAttribute,
  useUser,
  useUserAttribute,
  type UserAttributes,
} from "../../src/hooks";
import {
  PaywallRouter,
  replayStack,
  TRANSITION_MS,
  useRouter,
  type Entry,
  type RouteMap,
  type RouteName,
} from "../../src/navigation/index";
import { REPLAY_LIMIT, whileEntering } from "../../src/navigation/replay";
import { SuperwallProvider } from "../../src/provider/context";
import { createHost, flush, testConfig } from "../helpers";

const chain =
  (...names: string[]) =>
  (route: string): string | undefined =>
    names[names.indexOf(route) + 1];

const branchTo = (choice: string) => (route: string) =>
  route === "start" ? choice : route === "left" || route === "right" ? "end" : undefined;

const all = () => true;
const none = () => false;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("replayStack", () => {
  it("walks every answered route to the end of a straight flow", () => {
    expect(replayStack("a", chain("a", "b", "c"), all)).toEqual(["a", "b", "c"]);
  });

  it("stops on the first route that is not answered", () => {
    const answered = new Set(["a", "b"]);
    expect(replayStack("a", chain("a", "b", "c", "d"), (route) => answered.has(route))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("is the start alone when the start is not answered", () => {
    const next = vi.fn(chain("a", "b"));
    expect(replayStack("a", next, none)).toEqual(["a"]);
    expect(next).not.toHaveBeenCalled();
  });

  it("is the start alone when nothing follows it", () => {
    expect(replayStack("a", () => undefined, all)).toEqual(["a"]);
  });

  it("asks next only about answered routes, in order", () => {
    const next = vi.fn(chain("a", "b", "c"));
    const answered = vi.fn((route: string) => route !== "c");
    replayStack("a", next, answered);
    expect(answered.mock.calls).toEqual([["a"], ["b"], ["c"]]);
    expect(next.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("follows the branch next chooses", () => {
    expect(replayStack("start", branchTo("left"), all)).toEqual(["start", "left", "end"]);
    expect(replayStack("start", branchTo("right"), all)).toEqual(["start", "right", "end"]);
  });

  it.each<[string, unknown, string]>([
    ["an empty name", "", 'returned "", not a route'],
    ["null", null, "returned null, not a route"],
    ["a number", 42, "returned 42, not a route"],
    ["an object", { route: "b" }, 'returned {"route":"b"}, not a route'],
  ])("stops before %s, with a warning", (_, value, reason) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const next = (route: string) => (route === "a" ? "b" : (value as string));
    expect(replayStack("a", next, all)).toEqual(["a", "b"]);
    expect(warn).toHaveBeenCalledWith(
      `replayStack() stopped at "b": next("b") ${reason}. The flow resumes there.`,
    );
  });

  it("stops before a route it already passed, so a cycle cannot loop", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(replayStack("a", chain("a", "b", "c", "a"), all)).toEqual(["a", "b", "c"]);
    expect(replayStack("a", (route) => route, all)).toEqual(["a"]);
    expect(warn).toHaveBeenCalledWith(
      'replayStack() stopped at "c": next("c") returned "a" again, which would loop forever. The flow resumes there.',
    );
  });

  it(`stops at ${REPLAY_LIMIT} routes when next never repeats`, () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stack = replayStack("0", (route) => String(Number(route) + 1), all);
    expect(stack).toHaveLength(REPLAY_LIMIT);
    expect(stack.at(-1)).toBe(String(REPLAY_LIMIT - 1));
    expect(warn).toHaveBeenCalledWith(
      `replayStack() stopped at "${REPLAY_LIMIT - 1}": next("${REPLAY_LIMIT - 1}") went past ${REPLAY_LIMIT} routes. The flow resumes there.`,
    );
  });

  it("lets a throw from next or answered through, for entry to catch", () => {
    const thrown = new Error("no answers");
    expect(() =>
      replayStack(
        "a",
        () => {
          throw thrown;
        },
        all,
      ),
    ).toThrow(thrown);
    expect(() =>
      replayStack("a", chain("a"), () => {
        throw thrown;
      }),
    ).toThrow(thrown);
  });

  it("returns a fresh array each time", () => {
    const first = replayStack("a", chain("a", "b"), all);
    first.push("z");
    expect(replayStack("a", chain("a", "b"), all)).toEqual(["a", "b"]);
  });

  it("is typed with route names", () => {
    expectTypeOf(replayStack).parameter(0).toEqualTypeOf<RouteName>();
    expectTypeOf(replayStack)
      .parameter(1)
      .toEqualTypeOf<(route: RouteName) => RouteName | undefined>();
    expectTypeOf(replayStack).parameter(2).toEqualTypeOf<(route: RouteName) => boolean>();
    expectTypeOf(replayStack).returns.toEqualTypeOf<RouteName[]>();
    expectTypeOf(replayStack).returns.toMatchTypeOf<ReturnType<Entry>>();
  });
});

describe("replayStack inside entry", () => {
  it("stops before a name the surface does not have", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stack = whileEntering(["a", "b"], () => replayStack("a", chain("a", "b", "c"), all));
    expect(stack).toEqual(["a", "b"]);
    expect(warn).toHaveBeenCalledWith(
      'replayStack() stopped at "b": next("b") returned "c", which this surface does not have. The flow resumes there.',
    );
  });

  it("checks names only while entry runs, and restores the outer check after", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    whileEntering(["a"], () => {
      expect(whileEntering(["a", "b"], () => replayStack("a", chain("a", "b"), all))).toEqual([
        "a",
        "b",
      ]);
      expect(replayStack("a", chain("a", "b"), all)).toEqual(["a"]);
    });
    expect(() =>
      whileEntering(["a"], () => {
        throw new Error("thrown");
      }),
    ).toThrow("thrown");
    expect(replayStack("a", chain("a", "b"), all)).toEqual(["a", "b"]);
  });
});

type PageView = Extract<TOutgoingMessage, { event_name: "page_view" }>;

const GOAL = "onboarding_goal";
const LEVEL = "onboarding_level";
const TIME = "onboarding_time";
const goals = parseAsStringEnum(["lose", "build", "endure"]);
const levels = parseAsStringEnum(["new", "returning", "regular"]);
const times = parseAsStringEnum(["15", "30", "45"]);

type Answers = {
  goal: ReturnType<typeof goals.parse>;
  level: ReturnType<typeof levels.parse>;
  time: ReturnType<typeof times.parse>;
};

const answersOf = (user: UserAttributes): Answers => ({
  goal: readAttribute(user, GOAL, goals),
  level: readAttribute(user, LEVEL, levels),
  time: readAttribute(user, TIME, times),
});

let unknownAfterTime = false;

const next = (route: RouteName, answers: Answers): RouteName | undefined => {
  if (route === "index") return "goal";
  if (route === "goal") return answers.goal === "lose" ? "time" : "level";
  if (route === "level") return "time";
  if (route === "time") return unknownAfterTime ? "nowhere" : "plan";
  return undefined;
};

const answered = (route: RouteName, answers: Answers): boolean => {
  if (route === "index" || route === "goal") return answers.goal !== null;
  if (route === "level") return answers.level !== null;
  if (route === "time") return answers.time !== null;
  return false;
};

const entry: Entry = ({ user }) => {
  const answers = answersOf(user);
  return replayStack(
    "index",
    (route) => next(route, answers),
    (route) => answered(route, answers),
  );
};

let mounts: string[] = [];

const useMounted = (name: string) =>
  React.useLayoutEffect(() => {
    mounts.push(name);
  }, [name]);

const Intro = () => {
  const router = useRouter();
  const answers = answersOf(useUser());
  useMounted("index");
  return (
    <button type="button" onClick={() => router.push(next("index", answers) ?? "index")}>
      begin
    </button>
  );
};

const question = <T extends string>(
  route: "goal" | "level" | "time",
  key: string,
  options: readonly T[],
) =>
  function Question() {
    const router = useRouter();
    const answers = answersOf(useUser());
    const [value, setValue] = useUserAttribute(key, parseAsStringEnum(options));
    useMounted(route);
    return (
      <main>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => {
              setValue(option);
              router.push(next(route, { ...answers, [route]: option }) ?? "index");
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
  goal: { default: question("goal", GOAL, ["lose", "build", "endure"]) },
  level: { default: question("level", LEVEL, ["new", "returning", "regular"]) },
  time: { default: question("time", TIME, ["15", "30", "45"]) },
  plan: { default: Plan },
};

const launch = async (user: Record<string, unknown> = {}) => {
  mounts = [];
  const outgoing: TOutgoingMessage[] = [];
  const { transport, host } = createHost({ user, onOutgoing: (message) => outgoing.push(message) });
  const { unmount } = render(
    <SuperwallProvider config={testConfig} transport={transport}>
      <PaywallRouter routes={routes} Layout={Layout} entry={entry} navigationId="quiz" />
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
const stack = () =>
  [...document.querySelectorAll<HTMLElement>("[data-sw-route]")].map((el) => el.dataset.swRoute);
const active = () =>
  document.querySelector<HTMLElement>('[data-sw-state="active"]')?.dataset.swRoute;
const selected = () =>
  [...(layer(active() ?? "")?.querySelectorAll('[aria-pressed="true"]') ?? [])].map(
    (button) => button.textContent,
  );
const back = () => screen.queryByRole("button", { name: "back" });
const settle = () => act(() => vi.advanceTimersByTime(TRANSITION_MS));
const tap = (text: string) => {
  fireEvent.click(screen.getByText(text));
  settle();
};
const relaunch = async (previous: {
  persisted: () => Record<string, unknown>;
  kill: () => void;
}) => {
  const user = previous.persisted();
  previous.kill();
  vi.useRealTimers();
  return launch(user);
};

const expectSettledOn = (top: string, below: string[]) => {
  expect(stack()).toEqual([...below, top]);
  expect(mounts).toEqual([...below, top]);
  expect(active()).toBe(top);
  expect(layer(top)?.getAttribute("data-sw-settled")).toBe("");
  for (const name of [...below, top]) expect(layer(name)?.getAttribute("data-sw-phase")).toBeNull();
};

beforeEach(() => {
  unknownAfterTime = false;
  window.history.replaceState({}, "", "/?transport=editor");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a branching onboarding resumes down the branch the user took", () => {
  it("opens a new user on the intro", async () => {
    const { pageViews } = await launch();
    expectSettledOn("index", []);
    expect(back()).toBeNull();
    expect(pageViews()).toEqual([expect.objectContaining({ type: "entry", page_name: "index" })]);
  });

  it("skips the level question on the lose branch, live and after a quit", async () => {
    const first = await launch();
    vi.useFakeTimers();
    tap("begin");
    tap("goal:lose");
    expect(active()).toBe("time");
    expect(stack()).toEqual(["index", "goal", "time"]);
    expect(first.persisted()).toEqual({ [GOAL]: "lose" });

    const second = await relaunch(first);
    expectSettledOn("time", ["index", "goal"]);
    expect(second.pageViews()).toEqual([
      expect.objectContaining({ type: "entry", page_name: "time", flow_position: 2 }),
    ]);

    vi.useFakeTimers();
    expect(back()).not.toBeNull();
    fireEvent.click(back()!);
    settle();
    expect(active()).toBe("goal");
    expect(selected()).toEqual(["goal:lose"]);
    fireEvent.click(back()!);
    settle();
    expect(active()).toBe("index");
    expect(back()).toBeNull();
  });

  it("asks the level question on the build branch, and walks back through it", async () => {
    const first = await launch();
    vi.useFakeTimers();
    tap("begin");
    tap("goal:build");
    tap("level:returning");
    expect(first.persisted()).toEqual({ [GOAL]: "build", [LEVEL]: "returning" });

    await relaunch(first);
    expectSettledOn("time", ["index", "goal", "level"]);

    vi.useFakeTimers();
    const walked: [string | undefined, (string | null)[]][] = [];
    while (back()) {
      fireEvent.click(back()!);
      settle();
      walked.push([active(), selected()]);
    }
    expect(walked).toEqual([
      ["level", ["level:returning"]],
      ["goal", ["goal:build"]],
      ["index", []],
    ]);
  });

  it("follows the branch now chosen, not an answer left on the other one", async () => {
    const first = await launch({ [GOAL]: "build", [LEVEL]: "new" });
    expectSettledOn("time", ["index", "goal", "level"]);
    vi.useFakeTimers();
    fireEvent.click(back()!);
    settle();
    fireEvent.click(back()!);
    settle();
    expect(active()).toBe("goal");
    tap("goal:lose");
    expect(stack()).toEqual(["index", "goal", "time"]);

    await relaunch(first);
    expectSettledOn("time", ["index", "goal"]);
  });

  it("opens on the end of the flow once everything is answered, and starts over to the intro", async () => {
    const { pageViews } = await launch({ [GOAL]: "endure", [LEVEL]: "regular", [TIME]: "45" });
    expectSettledOn("plan", ["index", "goal", "level", "time"]);
    expect(pageViews()).toEqual([
      expect.objectContaining({ type: "entry", page_name: "plan", flow_position: 4 }),
    ]);

    vi.useFakeTimers();
    fireEvent.click(screen.getByText("start over"));
    settle();
    expect(stack()).toEqual(["index"]);
    expect(back()).toBeNull();
  });

  it("reads an answer the app stored badly as unanswered", async () => {
    await launch({ [GOAL]: "build", [LEVEL]: "expert", [TIME]: 30 });
    expectSettledOn("level", ["index", "goal"]);
    expect(selected()).toEqual([]);
  });

  it("stops before a route the surface does not have, instead of falling back to the intro", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    unknownAfterTime = true;
    await launch({ [GOAL]: "lose", [TIME]: "15" });
    expectSettledOn("time", ["index", "goal"]);
    expect(warn).toHaveBeenCalledWith(
      'replayStack() stopped at "time": next("time") returned "nowhere", which this surface does not have. The flow resumes there.',
    );
  });

  it("does the same in StrictMode", async () => {
    mounts = [];
    const { transport } = createHost({ user: { [GOAL]: "lose" } });
    render(
      <React.StrictMode>
        <SuperwallProvider config={testConfig} transport={transport}>
          <PaywallRouter routes={routes} Layout={Layout} entry={entry} />
        </SuperwallProvider>
      </React.StrictMode>,
    );
    await flush();
    expect(stack()).toEqual(["index", "goal", "time"]);
    expect(active()).toBe("time");
  });
});
