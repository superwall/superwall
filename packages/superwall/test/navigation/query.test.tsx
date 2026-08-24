import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createParser,
  createQueryStore,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsFloat,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  renderQuery,
  REPLACE_THROTTLE_MS,
  useQueryState,
} from "../../src/navigation/query";
import { PaywallRouter, useRouter, type RouteMap } from "../../src/navigation/index";
import { createWrapper } from "../helpers";

const search = () => window.location.search;

describe("parsers", () => {
  it("read and write strings, integers, floats and booleans", () => {
    expect(parseAsString.parse("a b")).toBe("a b");
    expect(parseAsInteger.parse("42")).toBe(42);
    expect(parseAsInteger.parse("x")).toBeNull();
    expect(parseAsInteger.serialize(4.6)).toBe("5");
    expect(parseAsFloat.parse("1.5")).toBe(1.5);
    expect(parseAsFloat.parse("nope")).toBeNull();
    expect(parseAsBoolean.parse("true")).toBe(true);
    expect(parseAsBoolean.parse("false")).toBe(false);
    expect(parseAsBoolean.parse("1")).toBeNull();
    expect(parseAsBoolean.serialize(true)).toBe("true");
  });

  it("accept only the listed strings for an enum", () => {
    const parser = parseAsStringEnum(["focus", "habit"]);
    expect(parser.parse("focus")).toBe("focus");
    expect(parser.parse("other")).toBeNull();
  });

  it("split and join arrays, dropping items that do not parse", () => {
    const parser = parseAsArrayOf(parseAsInteger);
    expect(parser.parse("1,x,3")).toEqual([1, 3]);
    expect(parser.parse("")).toEqual([]);
    expect(parser.serialize([1, 2])).toBe("1,2");
    expect(parser.eq([1, 2], [1, 2])).toBe(true);
    expect(parser.eq([1], [1, 2])).toBe(false);
    expect(parseAsArrayOf(parseAsString, "|").serialize(["a", "b"])).toBe("a|b");
  });

  it("carry a default and options without mutating the original", () => {
    const base = parseAsInteger;
    const withDefault = base.withDefault(3).withOptions({ history: "push" });
    expect(withDefault.defaultValue).toBe(3);
    expect(withDefault.history).toBe("push");
    expect(base.defaultValue).toBeUndefined();
    expect(base.history).toBeUndefined();
    expect(base.withOptions({ clearOnDefault: false }).withDefault(1).clearOnDefault).toBe(false);
  });

  it("build a custom parser with String as the default serializer", () => {
    const parser = createParser<Date>({
      parse: (value) => {
        const time = Number(value);
        return Number.isNaN(time) ? null : new Date(time);
      },
      serialize: (value) => String(value.getTime()),
      eq: (a, b) => a.getTime() === b.getTime(),
    });
    expect(parser.parse("1000")?.getTime()).toBe(1000);
    expect(parser.serialize(new Date(5))).toBe("5");
    expect(createParser<number>({ parse: Number }).serialize(7)).toBe("7");
  });
});

describe("renderQuery", () => {
  it("keeps commas, slashes and colons readable and encodes the rest", () => {
    const params = new URLSearchParams();
    params.set("sw_nav", "index,goals/setup");
    params.set("q", "a&b=c d");
    params.set("t", "12:30");
    expect(renderQuery(params)).toBe("?sw_nav=index,goals/setup&q=a%26b%3Dc+d&t=12:30");
    expect(renderQuery(new URLSearchParams())).toBe("");
  });
});

describe("the query store in memory", () => {
  it("holds values, notifies on change, and stays silent on a no-op write", () => {
    const store = createQueryStore(false);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ goal: "focus" }, "replace");
    expect(store.get("goal")).toBe("focus");
    expect(listener).toHaveBeenCalledTimes(1);

    store.set({ goal: "focus" }, "push");
    expect(listener).toHaveBeenCalledTimes(1);

    store.set({ goal: null, level: "pro" }, "replace");
    expect(store.get("goal")).toBeNull();
    expect(store.get("level")).toBe("pro");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(search()).toBe("");
  });

  it("stops notifying after unsubscribe", () => {
    const store = createQueryStore(false);
    const listener = vi.fn();
    store.subscribe(listener)();
    store.set({ goal: "focus" }, "replace");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("the query store on a URL", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts from the page URL", () => {
    window.history.replaceState({}, "", "/?goal=focus");
    expect(createQueryStore(true).get("goal")).toBe("focus");
  });

  it("coalesces replaces into one write and keeps foreign params", () => {
    window.history.replaceState({}, "", "/?theme=dark");
    const store = createQueryStore(true);
    const replaceState = vi.spyOn(window.history, "replaceState");

    store.set({ name: "C" }, "replace");
    store.set({ name: "Ch" }, "replace");
    store.set({ name: "Chr" }, "replace");
    expect(store.get("name")).toBe("Chr");
    expect(search()).toBe("?theme=dark");

    vi.advanceTimersByTime(REPLACE_THROTTLE_MS);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(search()).toBe("?theme=dark&name=Chr");
  });

  it("pushes immediately, carrying any pending replace with it", () => {
    const store = createQueryStore(true);
    const pushState = vi.spyOn(window.history, "pushState");

    store.set({ goal: "focus" }, "replace");
    store.set({ sw_nav: "goal" }, "push");
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(search()).toBe("?goal=focus&sw_nav=goal");
    vi.advanceTimersByTime(REPLACE_THROTTLE_MS);
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it("flushes before the page is hidden, so nothing is lost on a hand-off", () => {
    const store = createQueryStore(true);
    store.set({ goal: "focus" }, "replace");
    window.dispatchEvent(new Event("pagehide"));
    expect(search()).toBe("?goal=focus");

    store.set({ goal: "habit" }, "replace");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(search()).toBe("?goal=habit");
  });

  it("reloads from the URL on popstate and drops what was pending", () => {
    const store = createQueryStore(true);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ goal: "focus" }, "replace");

    window.history.replaceState({}, "", "/?goal=habit");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(store.get("goal")).toBe("habit");
    expect(listener).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(REPLACE_THROTTLE_MS);
    expect(search()).toBe("?goal=habit");
  });

  it("keeps working in memory when the browser refuses the write", () => {
    const store = createQueryStore(true);
    vi.spyOn(window.history, "pushState").mockImplementation(() => {
      throw new DOMException("rate limited", "SecurityError");
    });
    store.set({ goal: "focus" }, "push");
    expect(store.get("goal")).toBe("focus");
  });
});

const Goal = () => {
  const [goal, setGoal] = useQueryState("goal", parseAsStringEnum(["focus", "habit"]));
  const [count, setCount] = useQueryState("count", parseAsInteger.withDefault(0));
  const [note, setNote] = useQueryState("note");
  const router = useRouter();
  return (
    <div>
      <span data-testid="goal">{goal ?? "none"}</span>
      <span data-testid="count">{String(count)}</span>
      <span data-testid="note">{note ?? "none"}</span>
      <button type="button" onClick={() => setGoal("focus")}>
        focus
      </button>
      <button type="button" onClick={() => setGoal("habit", { history: "push" })}>
        habit
      </button>
      <button type="button" onClick={() => setGoal(null)}>
        clear
      </button>
      <button type="button" onClick={() => setCount((current) => current + 1)}>
        more
      </button>
      <button type="button" onClick={() => setCount(0)}>
        zero
      </button>
      <button type="button" onClick={() => setCount(0, { clearOnDefault: false })}>
        keep zero
      </button>
      <button type="button" onClick={() => setNote("hi there")}>
        note
      </button>
      <button type="button" onClick={() => router.push("plan")}>
        plan
      </button>
    </div>
  );
};

const Plan = () => {
  const [goal] = useQueryState("goal");
  return <span data-testid="plan-goal">{goal ?? "none"}</span>;
};

const routes: RouteMap = { index: { default: Goal }, plan: { default: Plan } };

const mount = (queryState: boolean) => {
  const Wrapper = createWrapper();
  return render(
    <Wrapper>
      <PaywallRouter routes={routes} queryState={queryState} navigationId="demo" />
    </Wrapper>,
  );
};

const text = (id: string) => screen.getByTestId(id).textContent;

describe("useQueryState", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is shared state across routes even without a URL", () => {
    mount(false);
    fireEvent.click(screen.getByText("focus"));
    expect(text("goal")).toBe("focus");
    fireEvent.click(screen.getByText("plan"));
    expect(text("plan-goal")).toBe("focus");
    expect(search()).toBe("");
  });

  it("writes the URL, clears on null and on the default, and honours per-call options", () => {
    mount(true);
    fireEvent.click(screen.getByText("focus"));
    act(() => vi.advanceTimersByTime(REPLACE_THROTTLE_MS));
    expect(search()).toBe("?goal=focus");

    fireEvent.click(screen.getByText("habit"));
    expect(search()).toBe("?goal=habit");

    fireEvent.click(screen.getByText("clear"));
    act(() => vi.advanceTimersByTime(REPLACE_THROTTLE_MS));
    expect(search()).toBe("");
    expect(text("goal")).toBe("none");

    fireEvent.click(screen.getByText("more"));
    fireEvent.click(screen.getByText("more"));
    expect(text("count")).toBe("2");
    act(() => vi.advanceTimersByTime(REPLACE_THROTTLE_MS));
    expect(search()).toBe("?count=2");

    fireEvent.click(screen.getByText("zero"));
    act(() => vi.advanceTimersByTime(REPLACE_THROTTLE_MS));
    expect(search()).toBe("");

    fireEvent.click(screen.getByText("keep zero"));
    act(() => vi.advanceTimersByTime(REPLACE_THROTTLE_MS));
    expect(search()).toBe("?count=0");

    fireEvent.click(screen.getByText("note"));
    act(() => vi.advanceTimersByTime(REPLACE_THROTTLE_MS));
    expect(search()).toBe("?count=0&note=hi+there");
    expect(text("note")).toBe("hi there");
  });

  it("reads what the URL already holds, falling back to the default for junk", () => {
    window.history.replaceState({}, "", "/?goal=habit&count=abc");
    mount(true);
    expect(text("goal")).toBe("habit");
    expect(text("count")).toBe("0");
  });

  it("follows the URL when the browser goes back", () => {
    window.history.replaceState({}, "", "/?goal=habit");
    mount(true);
    act(() => {
      window.history.replaceState({}, "", "/?goal=focus");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(text("goal")).toBe("focus");
  });

  it("refuses reserved keys and demands a router", () => {
    const Wrapper = createWrapper();
    const silence = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const key of ["sw_thing", "platform", "transport"]) {
      expect(() =>
        render(
          <Wrapper>
            <PaywallRouter
              routes={{
                index: {
                  default: () => {
                    useQueryState(key);
                    return null;
                  },
                },
              }}
            />
          </Wrapper>,
        ),
      ).toThrow(/reserved/);
    }
    expect(() => renderHook(() => useQueryState("goal"), { wrapper: Wrapper })).toThrow(
      /inside a paywall/,
    );
    silence.mockRestore();
  });
});
