import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostTransport, recordingDelegate } from "@superwall/host";
import type { ITransport, TOutgoingMessage } from "@superwall/runtime";
import {
  PaywallRouter,
  replayStack,
  TRANSITION_MS,
  useRouter,
  type Entry,
  type EntryVariables,
  type RouteMap,
} from "../../src/navigation/index";
import { HOST_STATE_TIMEOUT_MS, SuperwallProvider } from "../../src/provider/context";
import { createHost, flush, testConfig, testDevice, testProducts } from "../helpers";

type PageView = Extract<TOutgoingMessage, { event_name: "page_view" }>;

let mounts: string[] = [];
let seenAtMount: Record<string, string[]> = {};

const routeNames = () =>
  [...document.querySelectorAll<HTMLElement>("[data-sw-route]")].map(
    (el) => el.dataset.swRoute ?? "",
  );

const page = (name: string) =>
  function Page() {
    const router = useRouter();
    React.useLayoutEffect(() => {
      mounts.push(name);
      seenAtMount[name] = routeNames();
    }, []);
    return (
      <div>
        <span>at {name}</span>
        <button type="button" onClick={() => router.push("plan")}>
          push plan from {name}
        </button>
        <button type="button" onClick={() => router.dismissTo("goal")}>
          to goal from {name}
        </button>
        <button type="button" onClick={() => router.dismissTo("plan")}>
          to plan from {name}
        </button>
        <button type="button" onClick={() => router.reset(["index"])}>
          reset from {name}
        </button>
      </div>
    );
  };

const routes: RouteMap = {
  index: { default: page("index") },
  goal: { default: page("goal") },
  level: { default: page("level"), transition: "slide" },
  plan: { default: page("plan") },
};

const open = async (
  entry: Entry | undefined,
  options: { user?: Record<string, unknown>; strict?: boolean; url?: string } = {},
) => {
  window.history.replaceState({}, "", options.url ?? "/?transport=editor");
  const outgoing: TOutgoingMessage[] = [];
  const { transport } = createHost({
    user: options.user ?? {},
    onOutgoing: (message) => outgoing.push(message),
  });
  const tree = (
    <SuperwallProvider config={testConfig} transport={transport}>
      <PaywallRouter routes={routes} entry={entry} navigationId="quiz" />
    </SuperwallProvider>
  );
  render(options.strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
  await flush();
  return {
    pageViews: () =>
      outgoing.filter((message): message is PageView => message.event_name === "page_view"),
  };
};

const attribute = (name: string, key: string) =>
  document.querySelector(`[data-sw-route="${name}"]`)?.getAttribute(key) ?? null;
const active = () =>
  document.querySelector<HTMLElement>('[data-sw-state="active"]')?.dataset.swRoute;
const settle = () => act(() => vi.advanceTimersByTime(TRANSITION_MS));
const tap = (text: string) => {
  fireEvent.click(screen.getByText(text));
  settle();
};

beforeEach(() => {
  mounts = [];
  seenAtMount = {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("what entry may return", () => {
  it.each<[string, unknown]>([
    ["a number", 7],
    ["null", null],
    ["an object", { stack: ["goal"] }],
    ["a Set of names", new Set(["index", "goal"])],
    ["a list with a name and a number", ["index", 2]],
    ["a list with an empty name", ["index", ""]],
    ["a nested list", [["index", "goal"]]],
    ["a name the surface does not have", "nowhere"],
  ])("opens on index, with a warning naming the routes, for %s", async (_, returned) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { pageViews } = await open(() => returned as ReturnType<Entry>);

    expect(mounts).toEqual(["index"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Available routes: index, goal, level, plan"),
    );
    expect(pageViews()).toEqual([expect.objectContaining({ type: "entry", page_name: "index" })]);
  });

  it('opens on index for "index" and for ["index"], silently', async () => {
    const warn = vi.spyOn(console, "warn");
    await open(() => "index");
    expect(mounts).toEqual(["index"]);
    cleanup();
    mounts = [];
    await open(() => ["index"]);
    expect(mounts).toEqual(["index"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("takes a frozen list without changing it, and keeps no reference to it", async () => {
    const stack = Object.freeze(["index", "goal"] as const);
    await open(() => stack);
    vi.useFakeTimers();
    tap("push plan from goal");

    expect(stack).toEqual(["index", "goal"]);
    expect(routeNames()).toEqual(["index", "goal", "plan"]);
  });

  it("reports a throw that is not an Error, and opens on index", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await open(() => {
      throw "no attributes";
    });

    expect(mounts).toEqual(["index"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("entry() threw"), "no attributes");
  });

  it("opens on index when replayStack starts on a route the surface does not have", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(() =>
      replayStack(
        "intro",
        () => "goal",
        () => true,
      ),
    );

    expect(mounts).toEqual(["index"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('returned ["intro","goal"]'));
  });
});

describe("opening on an entry stack", () => {
  it("mounts the whole stack in one commit, so no page ever sees a shorter one", async () => {
    await open(() => ["index", "goal", "level"]);

    expect(mounts).toEqual(["index", "goal", "level"]);
    for (const name of mounts) expect(seenAtMount[name]).toEqual(["index", "goal", "level"]);
  });

  it("stamps the top with its own transition but runs none", async () => {
    await open(() => ["goal", "level"]);

    expect(attribute("level", "data-sw-transition")).toBe("slide");
    expect(attribute("level", "data-sw-settled")).toBe("");
    expect(attribute("level", "data-sw-phase")).toBeNull();
    expect(attribute("goal", "data-sw-phase")).toBeNull();
  });

  it("is used when the URL's sw_nav is empty", async () => {
    await open(() => ["index", "goal"], { url: "/?transport=editor&sw_nav=" });

    expect(mounts).toEqual(["index", "goal"]);
  });

  it("pushes forward from the top, reporting it as the previous page", async () => {
    const { pageViews } = await open(() => ["index", "goal"]);
    vi.useFakeTimers();

    fireEvent.click(screen.getByText("push plan from goal"));
    expect(attribute("plan", "data-sw-phase")).toBe("enter");
    expect(attribute("goal", "data-sw-phase")).toBe("recede");
    settle();

    expect(active()).toBe("plan");
    expect(pageViews().at(-1)).toEqual(
      expect.objectContaining({
        type: "forward",
        page_name: "plan",
        flow_position: 2,
        previous_page_node_id: "goal",
        previous_flow_position: 1,
      }),
    );
  });

  it("dismisses to a route it opened under, and replaces the top for one it did not", async () => {
    const { pageViews } = await open(() => ["index", "goal", "level"]);
    vi.useFakeTimers();

    tap("to goal from level");
    expect(routeNames()).toEqual(["index", "goal"]);
    expect(pageViews().at(-1)).toEqual(
      expect.objectContaining({ type: "back", page_name: "goal" }),
    );

    tap("to plan from goal");
    expect(routeNames()).toEqual(["index", "plan"]);
    expect(pageViews().at(-1)).toEqual(
      expect.objectContaining({ type: "forward", page_name: "plan", flow_position: 1 }),
    );
  });

  it("resets from the opened stack to the intro without a transition", async () => {
    const { pageViews } = await open(() => ["index", "goal", "level"]);
    vi.useFakeTimers();

    fireEvent.click(screen.getByText("reset from level"));

    expect(routeNames()).toEqual(["index"]);
    expect(attribute("index", "data-sw-transition")).toBe("none");
    expect(attribute("index", "data-sw-settled")).toBe("");
    expect(pageViews().at(-1)).toEqual(
      expect.objectContaining({ type: "back", page_name: "index" }),
    );
  });

  it("is called twice by StrictMode in development, like any state initializer, with the same variables", async () => {
    const seen: EntryVariables[] = [];
    const { pageViews } = await open(
      (variables) => {
        seen.push(variables);
        return ["index", "goal"];
      },
      { strict: true, user: { onboarding_goal: "build" } },
    );

    expect(seen).toHaveLength(2);
    for (const variables of seen) expect(variables.user).toEqual({ onboarding_goal: "build" });
    expect(routeNames()).toEqual(["index", "goal"]);
    expect(pageViews()).toEqual([expect.objectContaining({ type: "entry", page_name: "goal" })]);
  });
});

const hostAfter = (latencyMs: number, user: Record<string, unknown>) =>
  createHostTransport({
    latencyMs,
    delegate: recordingDelegate({}),
    state: { products: testProducts, device: testDevice, user },
  }).transport;

describe("entry and a host that is slow or silent", () => {
  const silent: ITransport = {
    postMessage: () => undefined,
    accept: () => undefined,
    addListener: () => undefined,
    startListening: () => undefined,
  };

  const mount = (transport: ITransport, entry: Entry) =>
    render(
      <SuperwallProvider config={testConfig} transport={transport}>
        <PaywallRouter routes={routes} entry={entry} />
      </SuperwallProvider>,
    );

  beforeEach(() => {
    window.history.replaceState({}, "", "/?transport=editor");
    vi.useFakeTimers();
  });

  it("runs on a late host's state and opens straight on the resumed page", () => {
    const entry = vi.fn<Entry>(({ user }) => (user.onboarding_goal ? ["index", "goal"] : "index"));
    mount(hostAfter(600, { onboarding_goal: "build" }), entry);

    act(() => vi.advanceTimersByTime(599));
    expect(entry).not.toHaveBeenCalled();
    expect(routeNames()).toEqual([]);

    act(() => vi.advanceTimersByTime(1));
    expect(entry).toHaveBeenCalledTimes(1);
    expect(mounts).toEqual(["index", "goal"]);
    expect(attribute("goal", "data-sw-settled")).toBe("");
  });

  it("runs once the wait gives up on a silent host, with an empty user", () => {
    const entry = vi.fn<Entry>(() => "index");
    mount(silent, entry);

    act(() => vi.advanceTimersByTime(HOST_STATE_TIMEOUT_MS - 1));
    expect(entry).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(entry).toHaveBeenCalledTimes(1);
    expect(entry.mock.calls[0][0].user).toEqual({});
    expect(mounts).toEqual(["index"]);
  });

  it("is not called again when the host's state changes after the first render", () => {
    const { transport, host } = createHostTransport({
      latencyMs: 1,
      delegate: recordingDelegate({}),
      state: { products: testProducts, device: testDevice, user: {} },
    });
    const entry = vi.fn<Entry>(({ user }) => (user.onboarding_goal ? ["index", "goal"] : "index"));
    mount(transport, entry);
    act(() => vi.advanceTimersByTime(1));

    act(() => host.update({ user: { onboarding_goal: "build" } }));
    act(() => vi.advanceTimersByTime(1));

    expect(entry).toHaveBeenCalledTimes(1);
    expect(routeNames()).toEqual(["index"]);
  });
});
