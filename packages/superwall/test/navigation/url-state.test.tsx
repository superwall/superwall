import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineSuperwallConfig, type TOutgoingMessage } from "@superwall/runtime";
import { REPLACE_THROTTLE_MS } from "../../src/navigation/query";
import {
  NAV_KEY,
  PaywallRouter,
  TRANSITION_MS,
  useRouter,
  type PaywallRouterProps,
  type RouteMap,
} from "../../src/navigation/index";
import { createWrapper, testConfig } from "../helpers";

const Screen = ({ label }: { label: string }) => {
  const router = useRouter();
  return (
    <div>
      <span>{`at ${label}`}</span>
      <span data-testid="depth">{String(router.depth)}</span>
      <button type="button" onClick={() => router.push("goal")}>
        push goal
      </button>
      <button type="button" onClick={() => router.push("goals/setup")}>
        push setup
      </button>
      <button type="button" onClick={() => router.replace("plan")}>
        replace plan
      </button>
      <button type="button" onClick={() => router.back()}>
        back
      </button>
    </div>
  );
};

const routes: RouteMap = {
  index: { default: () => <Screen label="index" /> },
  goal: { default: () => <Screen label="goal" /> },
  "goals/setup": { default: () => <Screen label="setup" /> },
  plan: { default: () => <Screen label="plan" /> },
};

type PageView = Extract<TOutgoingMessage, { event_name: "page_view" }>;

let views: PageView[] = [];

const mount = (props: Partial<PaywallRouterProps> = {}, config: typeof testConfig = testConfig) => {
  views = [];
  const Wrapper = createWrapper({
    config,
    mock: {
      onOutgoing: (message: TOutgoingMessage) => {
        if (message.event_name === "page_view") views.push(message as PageView);
      },
    },
  });
  return render(
    <Wrapper>
      <PaywallRouter routes={routes} navigationId="demo" queryState {...props} />
    </Wrapper>,
  );
};

const search = () => window.location.search;
const navParam = () => new URLSearchParams(search()).get(NAV_KEY);
const settle = () =>
  act(() => vi.advanceTimersByTime(Math.max(TRANSITION_MS, REPLACE_THROTTLE_MS)));
const attribute = (name: string, key: string) =>
  document.querySelector(`[data-sw-route="${name}"]`)?.getAttribute(key);
const depth = () => screen.getAllByTestId("depth").at(-1)?.textContent;

const arriveAt = (url: string) =>
  act(() => {
    window.history.replaceState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the route stack in the URL", () => {
  it("writes a push as a history entry and everything else in place", () => {
    mount();
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    expect(search()).toBe("");

    fireEvent.click(screen.getByText("push goal"));
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(navParam()).toBe("index,goal");
    settle();

    fireEvent.click(screen.getAllByText("push setup").at(-1) as HTMLElement);
    settle();
    expect(search()).toBe("?sw_nav=index,goal,goals/setup");

    fireEvent.click(screen.getAllByText("back").at(-1) as HTMLElement);
    settle();
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(replaceState).toHaveBeenCalled();
    expect(navParam()).toBe("index,goal");

    fireEvent.click(screen.getAllByText("replace plan").at(-1) as HTMLElement);
    settle();
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(navParam()).toBe("index,plan");
  });

  it("leaves the URL alone while the stack is just the first route", () => {
    window.history.replaceState({}, "", "/?theme=dark");
    mount();
    settle();
    expect(search()).toBe("?theme=dark");
  });

  it("restores a stack from the URL with no animation and reports one entry view", () => {
    window.history.replaceState({}, "", "/?sw_nav=index,goal,goals/setup");
    mount();

    expect(screen.getByText("at setup")).toBeDefined();
    expect(depth()).toBe("2");
    expect(attribute("goals/setup", "data-sw-settled")).toBe("");
    expect(attribute("index", "data-sw-state")).toBe("below");
    expect(views.map((view) => [view.type, view.page_name, view.flow_position])).toEqual([
      ["entry", "goals/setup", 2],
    ]);

    fireEvent.click(screen.getAllByText("back").at(-1) as HTMLElement);
    settle();
    expect(screen.getByText("at goal")).toBeDefined();
    expect(navParam()).toBe("index,goal");
  });

  it("starts over and rewrites the URL when it names a route that does not exist", () => {
    window.history.replaceState({}, "", "/?sw_nav=index,nowhere&goal=focus");
    mount();
    expect(screen.getByText("at index")).toBeDefined();
    settle();
    expect(search()).toBe("?goal=focus");
  });

  it("goes back when the browser does, playing the leaving route's transition", () => {
    mount();
    fireEvent.click(screen.getByText("push goal"));
    settle();
    fireEvent.click(screen.getAllByText("push setup").at(-1) as HTMLElement);
    settle();

    arriveAt("/?sw_nav=index,goal");

    const leaving = document.querySelector('[data-sw-state="exiting"]');
    expect(leaving?.getAttribute("data-sw-route")).toBe("goals/setup");
    expect(leaving?.getAttribute("data-sw-phase")).toBe("leave");
    expect(attribute("goal", "data-sw-phase")).toBe("return");
    settle();
    expect(screen.getByText("at goal")).toBeDefined();
    expect(depth()).toBe("1");
    expect(views.at(-1)?.type).toBe("back");
    expect(navParam()).toBe("index,goal");
  });

  it("goes forward when the browser does, keeping the routes it already has", () => {
    mount();
    fireEvent.click(screen.getByText("push goal"));
    settle();

    arriveAt("/?sw_nav=index,goal,goals/setup");
    expect(attribute("goals/setup", "data-sw-phase")).toBe("enter");
    expect(attribute("goal", "data-sw-phase")).toBe("recede");
    settle();
    expect(screen.getByText("at setup")).toBeDefined();
    expect(views.at(-1)?.type).toBe("forward");
  });

  it("swaps the top when the URL names a different branch", () => {
    mount();
    fireEvent.click(screen.getByText("push goal"));
    settle();

    arriveAt("/?sw_nav=index,plan");
    expect(document.querySelector('[data-sw-state="exiting"]')?.getAttribute("data-sw-route")).toBe(
      "goal",
    );
    settle();
    expect(screen.getByText("at plan")).toBeDefined();
    expect(screen.queryByText("at goal")).toBeNull();
    expect(depth()).toBe("1");
  });

  it("falls back to the first route when the browser lands on an unknown stack", () => {
    mount();
    fireEvent.click(screen.getByText("push goal"));
    settle();

    arriveAt("/?sw_nav=index,nowhere");
    settle();
    expect(screen.getByText("at index")).toBeDefined();
    expect(depth()).toBe("0");
  });
});

describe("when the URL is kept", () => {
  it("is off for a surface without checkout", () => {
    mount({ queryState: undefined });
    fireEvent.click(screen.getByText("push goal"));
    settle();
    expect(search()).toBe("");
  });

  it("is on for a surface with checkout, in any mode", () => {
    mount(
      { queryState: undefined },
      defineSuperwallConfig({ ...testConfig, checkout: "external" }),
    );
    fireEvent.click(screen.getByText("push goal"));
    settle();
    expect(navParam()).toBe("index,goal");
  });

  it("stays off when the surface says so, checkout or not", () => {
    mount({ queryState: false }, defineSuperwallConfig({ ...testConfig, checkout: "sheet" }));
    fireEvent.click(screen.getByText("push goal"));
    settle();
    expect(search()).toBe("");
  });

  it("never applies inside a native host", () => {
    const host = window as typeof window & { webkit?: unknown };
    host.webkit = { messageHandlers: { paywallMessageHandler: { postMessage: () => undefined } } };
    try {
      mount({ queryState: true });
      fireEvent.click(screen.getByText("push goal"));
      settle();
      expect(search()).toBe("");
    } finally {
      delete host.webkit;
    }
  });
});
