import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import {
  PaywallRouter,
  TRANSITION_MS,
  useIsFocused,
  useRouter,
  type Router,
  type RouteMap,
} from "../../src/navigation/index";
import { createWrapper } from "../helpers";

const Probe = () => {
  const router = useRouter();
  return (
    <>
      <span data-testid="name">{router.name}</span>
      <span data-testid="depth">{String(router.depth)}</span>
      <span data-testid="can-go-back">{String(router.canGoBack())}</span>
    </>
  );
};

const Index = () => {
  const router = useRouter();
  return (
    <div>
      <span>at index</span>
      <Probe />
      <button type="button" onClick={() => router.push("plans")}>
        To plans
      </button>
      <button type="button" onClick={() => router.replace("terms")}>
        Replace terms
      </button>
    </div>
  );
};

const Plans = () => {
  const router = useRouter();
  return (
    <div>
      <span>at plans</span>
      <Probe />
      <button type="button" onClick={() => router.push("onboarding/goals")}>
        Deeper
      </button>
      <button type="button" onClick={() => router.back()}>
        Back
      </button>
    </div>
  );
};

const Goals = () => {
  const router = useRouter();
  return (
    <div>
      <span>at goals</span>
      <Probe />
      <button type="button" onClick={() => router.dismissAll()}>
        Home
      </button>
      <button type="button" onClick={() => router.dismiss(2)}>
        Back two
      </button>
      <button type="button" onClick={() => router.dismissTo("terms")}>
        To terms
      </button>
      <button type="button" onClick={() => router.dismissTo("index")}>
        Back to index
      </button>
    </div>
  );
};

const Terms = () => {
  const router = useRouter();
  return (
    <div>
      <span>at terms</span>
      <span data-testid="can-go-back">{String(router.canGoBack())}</span>
    </div>
  );
};

const routes: RouteMap = {
  index: { default: Index },
  plans: { default: Plans, transition: "slide" },
  "onboarding/goals": { default: Goals },
  terms: { default: Terms, transition: "fade" },
};

const Layout = ({ children }: React.PropsWithChildren) => (
  <div>
    <span data-testid="chrome">chrome</span>
    {children}
  </div>
);

const mount = (
  options: {
    routes?: RouteMap;
    Layout?: React.ComponentType<React.PropsWithChildren>;
    onOutgoing?: (message: TOutgoingMessage) => void;
  } = {},
) => {
  const Wrapper = createWrapper(
    options.onOutgoing ? { host: { onOutgoing: options.onOutgoing } } : {},
  );
  return render(
    <Wrapper>
      <PaywallRouter
        routes={options.routes ?? routes}
        Layout={"Layout" in options ? options.Layout : Layout}
        navigationId="demo"
      />
    </Wrapper>,
  );
};

const pageViews = (onOutgoing: ReturnType<typeof vi.fn>) =>
  onOutgoing.mock.calls
    .map(([message]) => message as Extract<TOutgoingMessage, { event_name: "page_view" }>)
    .filter((message) => message.event_name === "page_view");

const attribute = (name: string, key: string): string | null | undefined =>
  document.querySelector(`[data-sw-route="${name}"]`)?.getAttribute(key);

const z = (name: string): number =>
  Number((document.querySelector(`[data-sw-route="${name}"]`) as HTMLElement).style.zIndex);

const settle = () => act(() => vi.advanceTimersByTime(TRANSITION_MS));

const tap = (label: string) => {
  fireEvent.click(screen.getByText(label));
  settle();
};

const TransitionCaller = () => {
  const router = useRouter();
  return (
    <div>
      <button type="button" onClick={() => router.push("plans", { transition: "none" })}>
        Explicit
      </button>
      <button type="button" onClick={() => router.push("terms")}>
        Configured
      </button>
    </div>
  );
};

let captured: Router | undefined;

const CaptureRoute = () => {
  captured = useRouter();
  return null;
};

const Orphan = () => {
  useRouter();
  return null;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PaywallRouter", () => {
  it("does not animate the first route in — on load the paywall is simply there", () => {
    mount();

    expect(attribute("index", "data-sw-settled")).toBe("");
  });

  it("still animates every navigation after the first", () => {
    mount();
    fireEvent.click(screen.getByText("To plans"));

    expect(attribute("plans", "data-sw-settled")).toBeNull();
    settle();
    expect(attribute("plans", "data-sw-settled")).toBe("");
  });

  it("starts at index and pushes onto the stack", () => {
    mount();

    expect(screen.getByText("at index")).toBeDefined();
    expect(screen.getByTestId("depth").textContent).toBe("0");
    expect(screen.getByTestId("can-go-back").textContent).toBe("false");

    tap("To plans");

    expect(screen.getByText("at plans")).toBeDefined();
    expect(screen.getAllByTestId("depth").at(-1)?.textContent).toBe("1");
    expect(screen.getAllByTestId("can-go-back").at(-1)?.textContent).toBe("true");
  });

  it("hands the routes to the layout as children and keeps it mounted", () => {
    mount();
    expect(screen.getAllByTestId("chrome")).toHaveLength(1);

    tap("To plans");

    expect(screen.getAllByTestId("chrome")).toHaveLength(1);
  });

  it("renders without a layout at all", () => {
    mount({ Layout: undefined });

    expect(screen.getByText("at index")).toBeDefined();
    expect(screen.queryByTestId("chrome")).toBeNull();

    tap("To plans");
    expect(screen.getByText("at plans")).toBeDefined();
  });

  it("keeps routes below the top mounted so their state survives a pop", () => {
    mount();
    tap("To plans");

    expect(screen.getByText("at index")).toBeDefined();

    tap("Back");

    expect(screen.getByText("at index")).toBeDefined();
    expect(screen.queryByText("at plans")).toBeNull();
  });

  it("inerts every route but the top, so nothing underneath is focusable", () => {
    mount();
    tap("To plans");

    expect(attribute("index", "data-sw-state")).toBe("behind");
    expect(attribute("index", "inert")).not.toBeNull();
    expect(attribute("plans", "data-sw-state")).toBe("active");
    expect(attribute("plans", "inert")).toBeNull();
  });

  it("pops by a count and to the top", () => {
    mount();
    tap("To plans");
    tap("Deeper");
    expect(screen.getAllByTestId("depth").at(-1)?.textContent).toBe("2");

    tap("Back two");
    expect(screen.getByText("at index")).toBeDefined();
    expect(screen.getByTestId("depth").textContent).toBe("0");

    tap("To plans");
    tap("Deeper");
    tap("Home");
    expect(screen.getByTestId("depth").textContent).toBe("0");
  });

  it("never pops past the root", () => {
    mount();
    tap("To plans");
    tap("Deeper");
    tap("Back two");
    tap("To plans");
    tap("Back");
    tap("To plans");
    tap("Deeper");
    tap("Home");

    expect(screen.getByText("at index")).toBeDefined();
    expect(screen.getByTestId("can-go-back").textContent).toBe("false");
  });

  it("replace swaps the top entry without growing the stack", () => {
    mount();
    tap("Replace terms");

    expect(screen.getByText("at terms")).toBeDefined();
    expect(screen.queryByText("at index")).toBeNull();
    expect(screen.getByTestId("can-go-back").textContent).toBe("false");
  });

  it("dismissTo unwinds to a route already in the stack", () => {
    mount();
    tap("To plans");
    tap("Deeper");
    expect(screen.getAllByTestId("depth").at(-1)?.textContent).toBe("2");

    tap("Back to index");

    expect(screen.getByText("at index")).toBeDefined();
    expect(screen.getByTestId("depth").textContent).toBe("0");
    expect(screen.getByTestId("can-go-back").textContent).toBe("false");
  });

  it("dismissTo replaces the current route when the target is not in the stack", () => {
    mount();
    tap("To plans");
    tap("Deeper");

    tap("To terms");

    expect(screen.getByText("at terms")).toBeDefined();
    expect(screen.queryByText("at goals")).toBeNull();
    expect(screen.getByText("at plans")).toBeDefined();
    expect(screen.getAllByTestId("can-go-back").at(-1)?.textContent).toBe("true");
  });

  it("keeps the leaving route on top when going back, so it slides off rather than under", () => {
    mount();
    tap("To plans");

    fireEvent.click(screen.getByText("Back"));

    const leaving = document.querySelector('[data-sw-state="exiting"]') as HTMLElement;
    const revealed = document.querySelector('[data-sw-state="active"]') as HTMLElement;
    expect(leaving.getAttribute("data-sw-route")).toBe("plans");
    expect(Number(leaving.style.zIndex)).toBeGreaterThan(Number(revealed.style.zIndex));
    settle();
  });

  it("puts the incoming route on top when going forward", () => {
    mount();
    fireEvent.click(screen.getByText("Replace terms"));

    const leaving = document.querySelector('[data-sw-state="exiting"]') as HTMLElement;
    const entering = document.querySelector('[data-sw-state="active"]') as HTMLElement;
    expect(Number(entering.style.zIndex)).toBeGreaterThan(Number(leaving.style.zIndex));
    settle();
  });

  it("stacks routes by their position, so deeper routes never paint over newer ones", () => {
    mount();
    tap("To plans");
    tap("Deeper");

    expect(z("index")).toBeLessThan(z("plans"));
    expect(z("plans")).toBeLessThan(z("onboarding/goals"));
  });

  it("plays the leaving route's transition when going back, not the revealed one", () => {
    mount();
    tap("To plans");

    fireEvent.click(screen.getByText("Back"));

    const leaving = document.querySelector('[data-sw-state="exiting"]');
    expect(leaving?.getAttribute("data-sw-route")).toBe("plans");
    expect(leaving?.getAttribute("data-sw-transition")).toBe("slide");
    expect(attribute("index", "data-sw-transition")).toBe("slide");
    settle();
  });

  it("moves the entering and leaving routes as one — never two different transitions at once", () => {
    mount();
    fireEvent.click(screen.getByText("Replace terms"));

    const leaving = document.querySelector('[data-sw-state="exiting"]');
    const entering = document.querySelector('[data-sw-state="active"]');
    expect(leaving?.getAttribute("data-sw-transition")).toBe("fade");
    expect(entering?.getAttribute("data-sw-transition")).toBe("fade");
    settle();
  });

  it("names the phase each route is playing, and drops it once settled", () => {
    mount();
    expect(attribute("index", "data-sw-phase")).toBeNull();

    fireEvent.click(screen.getByText("To plans"));
    expect(attribute("plans", "data-sw-phase")).toBe("enter");
    expect(attribute("index", "data-sw-phase")).toBe("recede");

    settle();
    expect(attribute("plans", "data-sw-phase")).toBeNull();
    expect(attribute("index", "data-sw-phase")).toBeNull();
  });

  it("names leave and return going back, so a transition can reverse itself", () => {
    mount();
    tap("To plans");

    fireEvent.click(screen.getByText("Back"));

    expect(document.querySelector('[data-sw-state="exiting"]')?.getAttribute("data-sw-phase")).toBe(
      "leave",
    );
    expect(attribute("index", "data-sw-phase")).toBe("return");
    settle();
  });

  it("gives a buried route no phase at all", () => {
    mount();
    tap("To plans");
    fireEvent.click(screen.getByText("Deeper"));

    expect(attribute("index", "data-sw-state")).toBe("below");
    expect(attribute("index", "data-sw-phase")).toBeNull();
    settle();
  });

  it("moves the route directly behind, so push reads as parallax", () => {
    mount();
    tap("To plans");

    expect(attribute("index", "data-sw-state")).toBe("behind");
    expect(attribute("index", "data-sw-transition")).toBe("slide");
  });

  it("leaves routes deeper than one below out of the animation entirely", () => {
    mount();
    tap("To plans");
    tap("Deeper");

    expect(attribute("index", "data-sw-state")).toBe("below");
    expect(attribute("index", "data-sw-transition")).toBe("none");
    expect(attribute("plans", "data-sw-state")).toBe("behind");
  });

  it("falls back to the surface default when a route declares nothing", () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <PaywallRouter
          routes={{ index: { default: Index }, plans: { default: Plans } }}
          transition="fade"
        />
      </Wrapper>,
    );

    expect(attribute("index", "data-sw-transition")).toBe("fade");

    fireEvent.click(screen.getByText("To plans"));
    expect(attribute("plans", "data-sw-transition")).toBe("fade");
    settle();
  });

  it("lets a route's own export beat the surface default", () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <PaywallRouter
          routes={{
            index: { default: TransitionCaller },
            plans: { default: Plans },
            terms: { default: Terms, transition: "fade" },
          }}
          transition="slide"
        />
      </Wrapper>,
    );

    tap("Configured");

    expect(attribute("terms", "data-sw-transition")).toBe("fade");
  });

  it("lets the call site beat both the route and the surface default", () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <PaywallRouter
          routes={{
            index: { default: TransitionCaller },
            plans: { default: Plans, transition: "fade" },
            terms: { default: Terms },
          }}
          transition="slide"
        />
      </Wrapper>,
    );

    tap("Explicit");

    expect(attribute("plans", "data-sw-transition")).toBe("none");
  });

  it("carries a project's own transition name through untouched", () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <PaywallRouter
          routes={{ index: { default: Index }, plans: { default: Plans, transition: "zoom" } }}
        />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("To plans"));

    expect(attribute("plans", "data-sw-transition")).toBe("zoom");
    settle();
  });

  it("accepts a custom name as the surface default too", () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <PaywallRouter
          routes={{ index: { default: Index }, plans: { default: Plans } }}
          transition="zoom"
        />
      </Wrapper>,
    );

    expect(attribute("index", "data-sw-transition")).toBe("zoom");
  });

  it("defaults to push when nothing declares a transition at all", () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <PaywallRouter routes={{ index: { default: Index }, plans: { default: Plans } }} />
      </Wrapper>,
    );

    expect(attribute("index", "data-sw-transition")).toBe("push");
  });

  it("takes the transition from the call site, else the route's own export", () => {
    mount({ routes: { ...routes, index: { default: TransitionCaller } } });

    expect(attribute("index", "data-sw-transition")).toBe("push");

    tap("Explicit");
    expect(attribute("plans", "data-sw-transition")).toBe("none");

    tap("Back");
    tap("Configured");
    expect(attribute("terms", "data-sw-transition")).toBe("fade");
  });

  it("throws a listing error for an unknown route", () => {
    mount({ routes: { index: { default: CaptureRoute }, plans: { default: Plans } } });

    expect(() => captured?.push("nope")).toThrow(/Unknown route "nope"/);
    expect(() => captured?.push("nope")).toThrow(/Available routes: index, plans/);
  });

  it("throws when useRouter is called outside a router", () => {
    expect(() => render(<Orphan />)).toThrow(/must be used inside a paywall/);
  });
});

const Focus = ({ label }: { label: string }) => (
  <span data-testid={label}>{String(useIsFocused())}</span>
);

const FocusFirst = () => {
  const router = useRouter();
  return (
    <div>
      <Focus label="first" />
      <button type="button" onClick={() => router.push("plans")}>
        Go
      </button>
    </div>
  );
};

const FocusSecond = () => <Focus label="second" />;

describe("useIsFocused", () => {
  it("is true only for the top route", () => {
    mount({ routes: { index: { default: FocusFirst }, plans: { default: FocusSecond } } });

    expect(screen.getByTestId("first").textContent).toBe("true");

    tap("Go");

    expect(screen.getByTestId("first").textContent).toBe("false");
    expect(screen.getByTestId("second").textContent).toBe("true");
  });
});

describe("page_view", () => {
  it("reports entry, then forward and back with the previous position", () => {
    const onOutgoing = vi.fn<(message: TOutgoingMessage) => void>();
    mount({ onOutgoing });

    tap("To plans");
    tap("Back");

    const views = pageViews(onOutgoing);
    expect(views.map((view) => [view.type, view.page_name, view.flow_position])).toEqual([
      ["entry", "index", 0],
      ["forward", "plans", 1],
      ["back", "index", 0],
    ]);
    expect(views[1].previous_page_node_id).toBe("index");
    expect(views[1].previous_flow_position).toBe(0);
    expect(views.every((view) => view.navigation_node_id === "demo")).toBe(true);
    expect(views[0].previous_page_node_id).toBeUndefined();
  });

  it("carries the time spent on the previous route", () => {
    const onOutgoing = vi.fn<(message: TOutgoingMessage) => void>();
    mount({ onOutgoing });
    tap("To plans");

    const views = pageViews(onOutgoing);
    expect(views[0].time_on_previous_page_ms).toBeUndefined();
    expect(views[1].time_on_previous_page_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("interrupting a transition", () => {
  it("gives the interrupting navigation its full time instead of the one it cut off", () => {
    mount();

    fireEvent.click(screen.getByText("To plans"));
    act(() => vi.advanceTimersByTime(TRANSITION_MS * 0.4));
    fireEvent.click(screen.getByText("Deeper"));

    // The first navigation's remaining 60% must not settle the second one.
    act(() => vi.advanceTimersByTime(TRANSITION_MS * 0.6));
    expect(attribute("onboarding/goals", "data-sw-settled")).toBeNull();

    act(() => vi.advanceTimersByTime(TRANSITION_MS * 0.4));
    expect(attribute("onboarding/goals", "data-sw-settled")).toBe("");
  });

  it("survives a spammed button — every tap lands and the stack is still coherent", () => {
    mount();

    fireEvent.click(screen.getByText("To plans"));
    fireEvent.click(screen.getByText("Deeper"));
    fireEvent.click(screen.getByText("Back"));
    settle();

    const active = document.querySelector('[data-sw-route][data-sw-state="active"]');
    expect(active?.getAttribute("data-sw-route")).toBe("plans");
    expect(active?.querySelector('[data-testid="depth"]')?.textContent).toBe("1");
    expect(active?.getAttribute("data-sw-settled")).toBe("");
    expect(document.querySelectorAll("[data-sw-route]")).toHaveLength(2);
  });

  it("settles a navigation that interrupts an untimed one", () => {
    mount({ routes: { ...routes, index: { default: TransitionCaller } } });

    fireEvent.click(screen.getByText("Explicit"));
    fireEvent.click(screen.getByText("Deeper"));
    settle();

    expect(attribute("onboarding/goals", "data-sw-settled")).toBe("");
  });
});
