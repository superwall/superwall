import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import {
  PaywallRouter,
  TRANSITION_MS,
  useRouter,
  type Entry,
  type EntryVariables,
  type RouteMap,
} from "../../src/navigation/index";
import { SuperwallProvider } from "../../src/provider/context";
import { createHost, flush, testConfig } from "../helpers";

type PageView = Extract<TOutgoingMessage, { event_name: "page_view" }>;

let mounts: string[] = [];

const page = (name: string) => () => {
  const router = useRouter();
  React.useLayoutEffect(() => {
    mounts.push(name);
  }, []);
  return (
    <div>
      <span>at {name}</span>
      <button type="button" onClick={() => router.back()}>
        back from {name}
      </button>
      <button type="button" onClick={() => router.dismissAll()}>
        start over from {name}
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

const ANSWERED = "onboarding_goal";

const resume: Entry = ({ user }) => (user[ANSWERED] ? ["index", "goal", "level"] : "index");

const open = async (
  entry: Entry | undefined,
  options: { user?: Record<string, unknown>; strict?: boolean; url?: string } = {},
) => {
  window.history.replaceState({}, "", options.url ?? "/?transport=editor");
  const outgoing: TOutgoingMessage[] = [];
  const { transport } = createHost({
    user: options.user ?? {},
    params: { source: "launch" },
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
  document.querySelector(`[data-sw-route="${name}"]`)?.getAttribute(key);

const settle = () => act(() => vi.advanceTimersByTime(TRANSITION_MS));

beforeEach(() => {
  mounts = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("entry decides the stack a surface opens on", () => {
  it("is called once, after the host's first state is in", async () => {
    const seen: EntryVariables[] = [];
    await open(
      (variables) => {
        seen.push(variables);
        return "index";
      },
      { user: { [ANSWERED]: "build" } },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].user[ANSWERED]).toBe("build");
    expect(seen[0].params).toEqual({ source: "launch" });
    expect(seen[0].device.platform).toBe("iOS");
    expect(Object.keys(seen[0]).toSorted()).toEqual(["device", "params", "user"]);
  });

  it("opens on the stack it returns, without mounting what is not in it", async () => {
    await open(() => ["goal", "level"]);

    expect(mounts).toEqual(["goal", "level"]);
    expect(attribute("level", "data-sw-state")).toBe("active");
    expect(attribute("goal", "data-sw-state")).toBe("behind");
    expect(document.querySelector('[data-sw-route="index"]')).toBeNull();
  });

  it("lands with nothing animating", async () => {
    await open(resume, { user: { [ANSWERED]: "build" } });

    expect(attribute("level", "data-sw-settled")).toBe("");
    expect(attribute("level", "data-sw-phase")).toBeNull();
    expect(attribute("goal", "data-sw-phase")).toBeNull();
  });

  it("reports one entry page view, for the top route", async () => {
    const { pageViews } = await open(resume, { user: { [ANSWERED]: "build" } });

    expect(pageViews()).toEqual([
      expect.objectContaining({
        type: "entry",
        page_name: "level",
        flow_position: 2,
        navigation_node_id: "quiz",
      }),
    ]);
  });

  it("goes back down the stack it opened on, and start over returns to index", async () => {
    await open(resume, { user: { [ANSWERED]: "build" } });
    vi.useFakeTimers();

    fireEvent.click(screen.getByText("back from level"));
    expect(attribute("level", "data-sw-transition")).toBe("slide");
    settle();
    expect(screen.queryByText("at level")).toBeNull();
    expect(attribute("goal", "data-sw-state")).toBe("active");

    fireEvent.click(screen.getByText("start over from goal"));
    settle();
    expect(attribute("index", "data-sw-state")).toBe("active");
    expect(screen.queryByText("at goal")).toBeNull();
  });

  it("takes a single route name", async () => {
    await open(() => "plan");

    expect(mounts).toEqual(["plan"]);
    expect(attribute("plan", "data-sw-state")).toBe("active");
  });

  it("opens on index for an empty stack", async () => {
    await open(() => []);

    expect(mounts).toEqual(["index"]);
  });

  it("opens on index without an entry", async () => {
    await open(undefined);

    expect(mounts).toEqual(["index"]);
  });

  it("does the same in StrictMode", async () => {
    const { pageViews } = await open(resume, { user: { [ANSWERED]: "build" }, strict: true });

    expect(new Set(mounts)).toEqual(new Set(["index", "goal", "level"]));
    expect(attribute("level", "data-sw-state")).toBe("active");
    expect(attribute("level", "data-sw-settled")).toBe("");
    expect(pageViews()).toEqual([expect.objectContaining({ type: "entry", page_name: "level" })]);
  });
});

describe("what entry gives way to", () => {
  it("loses to a stack in the URL", async () => {
    const entry = vi.fn<Entry>(() => ["index", "goal", "level"]);
    await open(entry, { url: "/?transport=editor&sw_nav=index,plan" });

    expect(entry).not.toHaveBeenCalled();
    expect(mounts).toEqual(["index", "plan"]);
  });

  it("wins over a URL stack that names a route the surface does not have", async () => {
    await open(() => ["index", "goal"], { url: "/?transport=editor&sw_nav=index,nowhere" });

    expect(mounts).toEqual(["index", "goal"]);
  });

  it.each<[string, ReturnType<Entry> | undefined]>([
    ["an unknown route", ["index", "nowhere"]],
    ["nothing", undefined],
    ["something other than a name", [42 as unknown as string]],
  ])("opens on index and warns when it returns %s", async (_, stack) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(() => stack as ReturnType<Entry>);

    expect(mounts).toEqual(["index"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Available routes: index, goal"));
  });

  it("opens on index and reports the error when it throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const thrown = new Error("no attributes");
    const { pageViews } = await open(() => {
      throw thrown;
    });

    expect(mounts).toEqual(["index"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("entry() threw"), thrown);
    expect(pageViews()).toEqual([expect.objectContaining({ type: "entry", page_name: "index" })]);
  });
});
