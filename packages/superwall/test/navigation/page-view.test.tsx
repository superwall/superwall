import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { PaywallRouter, TRANSITION_MS, useRouter, type RouteMap } from "../../src/navigation/index";
import { createWrapper } from "../helpers";

type PageView = Extract<TOutgoingMessage, { event_name: "page_view" }>;

const Screen = ({ label }: { label: string }) => {
  const router = useRouter();
  return (
    <div>
      <span>{label}</span>
      <button type="button" onClick={() => router.push("plans")}>
        push plans
      </button>
      <button type="button" onClick={() => router.push("goals/experience")}>
        push nested
      </button>
      <button type="button" onClick={() => router.push("terms")}>
        push terms
      </button>
      <button type="button" onClick={() => router.replace("terms")}>
        replace terms
      </button>
      <button type="button" onClick={() => router.back()}>
        back
      </button>
      <button type="button" onClick={() => router.dismiss(2)}>
        dismiss two
      </button>
      <button type="button" onClick={() => router.dismissAll()}>
        dismiss all
      </button>
      <button type="button" onClick={() => router.dismissTo("index")}>
        dismiss to index
      </button>
      <button type="button" onClick={() => router.dismissTo("plans")}>
        dismiss to plans
      </button>
      <button type="button" onClick={() => router.reset(["index", "plans", "terms"])}>
        reset to terms
      </button>
      <button
        type="button"
        onClick={() => {
          router.reset(["index", "plans"]);
          router.push("terms");
        }}
      >
        reset then push
      </button>
      <button
        type="button"
        onClick={() => {
          router.reset(["index", "plans", "terms"]);
          router.back();
        }}
      >
        reset then back
      </button>
    </div>
  );
};

const routes: RouteMap = {
  index: { default: () => <Screen label="index" /> },
  plans: { default: () => <Screen label="plans" /> },
  "goals/experience": { default: () => <Screen label="experience" /> },
  terms: { default: () => <Screen label="terms" /> },
};

let sent: PageView[] = [];

const resuming: RouteMap = {
  ...routes,
  index: {
    default: () => {
      const router = useRouter();
      React.useLayoutEffect(() => router.reset(["index", "plans", "goals/experience"]), []);
      return <Screen label="index" />;
    },
  },
};

const mount = (strict = false, map: RouteMap = routes) => {
  sent = [];
  const onOutgoing = (message: TOutgoingMessage) => {
    if (message.event_name === "page_view") sent.push(message as PageView);
  };
  const Wrapper = createWrapper({ host: { onOutgoing } });
  const tree = (
    <Wrapper>
      <PaywallRouter routes={map} navigationId="get-started" />
    </Wrapper>
  );
  return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
};

const tap = (label: string) => {
  fireEvent.click(screen.getAllByText(label).at(-1) as HTMLElement);
  act(() => vi.advanceTimersByTime(TRANSITION_MS));
};

/** Every view as [type, page, flow_position] — the shape analytics actually consumes. */
const trail = () => sent.map((view) => [view.type, view.page_name, view.flow_position]);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("page_view is reported for every navigation", () => {
  it("reports entry exactly once on open, with no previous page", () => {
    mount();

    expect(trail()).toEqual([["entry", "index", 0]]);
    expect(sent[0].previous_page_node_id).toBeUndefined();
    expect(sent[0].previous_flow_position).toBeUndefined();
    expect(sent[0].time_on_previous_page_ms).toBeUndefined();
  });

  it("does not double-report under StrictMode, which double-invokes effects", () => {
    mount(true);

    expect(trail()).toEqual([["entry", "index", 0]]);
  });

  it("reports a push as forward, carrying the page it came from", () => {
    mount();
    tap("push plans");

    expect(trail()).toEqual([
      ["entry", "index", 0],
      ["forward", "plans", 1],
    ]);
    expect(sent[1].previous_page_node_id).toBe("index");
    expect(sent[1].previous_flow_position).toBe(0);
  });

  it("reports a back", () => {
    mount();
    tap("push plans");
    tap("back");

    expect(trail()).toEqual([
      ["entry", "index", 0],
      ["forward", "plans", 1],
      ["back", "index", 0],
    ]);
  });

  it("reports a replace as forward at the same depth", () => {
    mount();
    tap("push plans");
    tap("replace terms");

    expect(trail()).toEqual([
      ["entry", "index", 0],
      ["forward", "plans", 1],
      ["forward", "terms", 1],
    ]);
    expect(sent[2].previous_page_node_id).toBe("plans");
    expect(sent[2].previous_flow_position).toBe(1);
  });

  it("reports a multi-step dismiss once, with the position it jumped from", () => {
    mount();
    tap("push plans");
    tap("push nested");
    tap("dismiss two");

    expect(trail()).toEqual([
      ["entry", "index", 0],
      ["forward", "plans", 1],
      ["forward", "goals/experience", 2],
      ["back", "index", 0],
    ]);
    expect(sent[3].previous_flow_position).toBe(2);
  });

  it("reports dismissAll once", () => {
    mount();
    tap("push plans");
    tap("push nested");
    tap("dismiss all");

    expect(trail().at(-1)).toEqual(["back", "index", 0]);
    expect(sent).toHaveLength(4);
  });

  it("reports dismissTo as back when the target is in the stack", () => {
    mount();
    tap("push plans");
    tap("push nested");
    tap("dismiss to index");

    expect(trail().at(-1)).toEqual(["back", "index", 0]);
  });

  it("reports dismissTo as forward when the target has to be substituted in", () => {
    mount();
    tap("push plans");
    tap("push terms");
    tap("dismiss to plans");

    expect(trail().at(-1)).toEqual(["back", "plans", 1]);
  });

  it("reports nested route names in full", () => {
    mount();
    tap("push nested");

    expect(sent[1].page_name).toBe("goals/experience");
    expect(sent[1].page_node_id).toBe("goals/experience");
  });

  it("stamps every view with the surface as the navigation node", () => {
    mount();
    tap("push plans");
    tap("back");

    expect(sent.every((view) => view.navigation_node_id === "get-started")).toBe(true);
  });

  it("reports the same route again when it is pushed at a deeper position", () => {
    mount();
    tap("push plans");
    tap("push plans");

    expect(trail()).toEqual([
      ["entry", "index", 0],
      ["forward", "plans", 1],
      ["forward", "plans", 2],
    ]);
  });

  it("stays silent when a navigation changes nothing", () => {
    mount();
    tap("back");
    tap("dismiss all");
    tap("dismiss to index");

    expect(trail()).toEqual([["entry", "index", 0]]);
  });

  it("times each page, and never reports a negative duration", () => {
    mount();
    tap("push plans");
    act(() => vi.advanceTimersByTime(1200));
    tap("back");

    expect(sent[1].time_on_previous_page_ms).toBeGreaterThanOrEqual(0);
    expect(sent[2].time_on_previous_page_ms).toBeGreaterThanOrEqual(1200);
  });

  it("emits one view per navigation across a long session — no drops, no duplicates", () => {
    mount();
    const steps = [
      "push plans",
      "push nested",
      "back",
      "back",
      "push terms",
      "back",
      "push plans",
      "dismiss all",
    ];
    for (const step of steps) tap(step);

    expect(sent).toHaveLength(steps.length + 1);
    const positions = sent.map((view) => view.flow_position);
    expect(positions).toEqual([0, 1, 2, 1, 0, 1, 0, 1, 0]);
  });

  it("chains previous → current so a funnel can be reconstructed from the stream alone", () => {
    mount();
    tap("push plans");
    tap("push nested");
    tap("back");

    for (let i = 1; i < sent.length; i++) {
      expect(sent[i].previous_page_node_id).toBe(sent[i - 1].page_name);
      expect(sent[i].previous_flow_position).toBe(sent[i - 1].flow_position);
    }
  });
});

describe("a reset", () => {
  it("reports only where a reset before the first paint lands, as the entry", () => {
    mount(false, resuming);

    expect(trail()).toEqual([["entry", "goals/experience", 2]]);
    expect(sent[0].previous_page_node_id).toBeUndefined();
  });

  it("reports that entry once under StrictMode, which resets twice", () => {
    mount(true, resuming);

    expect(trail()).toEqual([["entry", "goals/experience", 2]]);
  });

  it("reports a reset after the first paint like any other navigation", () => {
    mount();
    tap("reset to terms");

    expect(trail()).toEqual([
      ["entry", "index", 0],
      ["forward", "terms", 2],
    ]);
    expect(sent[1].previous_page_node_id).toBe("index");
  });

  it("reports the navigation that follows a reset in the same moment", () => {
    mount();
    tap("reset then push");

    expect(trail()).toEqual([
      ["entry", "index", 0],
      ["forward", "terms", 2],
    ]);
  });

  it("reports a back that follows a reset in the same moment", () => {
    mount();
    tap("reset then back");

    expect(trail()).toEqual([
      ["entry", "index", 0],
      ["back", "plans", 1],
    ]);
  });
});
