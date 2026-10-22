import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import * as hooks from "../../src/hooks";
import {
  createParser,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsFloat,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  readAttribute,
  useUser,
  useUserAttribute,
  type Parser,
  type SetUserAttribute,
  type UserAttributes,
} from "../../src/hooks";
import * as navigation from "../../src/navigation/index";
import * as parsers from "../../src/parsers";
import { SuperwallProvider } from "../../src/provider/context";
import { createHost, flush, testConfig } from "../helpers";

type Written = Extract<TOutgoingMessage, { event_name: "user_attribute_updated" }>["attributes"];

const GOALS = ["lose", "build", "endure"] as const;
const goals = parseAsStringEnum(GOALS);

const mount = async <T,>(hook: () => T, user: Record<string, unknown> = {}) => {
  const outgoing: TOutgoingMessage[] = [];
  const { transport, host } = createHost({ user, onOutgoing: (message) => outgoing.push(message) });
  const view = renderHook(hook, {
    wrapper: ({ children }: React.PropsWithChildren) => (
      <SuperwallProvider config={testConfig} transport={transport}>
        {children}
      </SuperwallProvider>
    ),
  });
  await flush();
  return {
    ...view,
    host,
    writes: (): Written[] =>
      outgoing.flatMap((message) =>
        message.event_name === "user_attribute_updated" ? [message.attributes] : [],
      ),
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

const point = createParser<{ x: number; y: number }>({
  parse: (value) => {
    const [x, y] = value.split(":").map(Number);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  },
  serialize: ({ x, y }) => `${x}:${y}`,
  eq: (a, b) => a.x === b.x && a.y === b.y,
});

const readings: [string, Parser<unknown>, unknown, unknown][] = [
  ["a string", parseAsString, "Ada", "Ada"],
  ["an empty string", parseAsString, "", ""],
  ["an integer", parseAsInteger, "42", 42],
  ["the integer part of a decimal", parseAsInteger, "4.7", 4],
  ["a negative integer", parseAsInteger, "-3", -3],
  ["garbage as an integer", parseAsInteger, "abc", null],
  ["a float", parseAsFloat, "2.5", 2.5],
  ["garbage as a float", parseAsFloat, "x2", null],
  ["true", parseAsBoolean, "true", true],
  ["false", parseAsBoolean, "false", false],
  ["anything else as a boolean", parseAsBoolean, "yes", null],
  ["a known enum value", goals, "build", "build"],
  ["an unknown enum value", goals, "bulk", null],
  ["an enum value in the wrong case", goals, "Build", null],
  ["a list", parseAsArrayOf(parseAsInteger), "1,2,3", [1, 2, 3]],
  ["an empty list", parseAsArrayOf(parseAsInteger), "", []],
  [
    "a list dropping what it cannot read",
    parseAsArrayOf(goals),
    "lose,bulk,build",
    ["lose", "build"],
  ],
  ["a list with its own separator", parseAsArrayOf(parseAsString, "|"), "a|b", ["a", "b"]],
  ["a custom type", point, "3:4", { x: 3, y: 4 }],
  ["garbage as a custom type", point, "3", null],
  ["the string null", parseAsString, "null", null],
  ["the string undefined", parseAsString, "undefined", null],
  ["the string null as an enum", goals, "null", null],
  ["a number an app set", parseAsInteger, 30, 30],
  ["a number an app set, as a string", parseAsString, 30, "30"],
  ["a float an app set", parseAsFloat, 1.5, 1.5],
  ["a boolean an app set", parseAsBoolean, true, true],
  ["a number that is not an enum value", goals, 3, null],
  ["null", parseAsString, null, null],
  ["undefined", parseAsString, undefined, null],
  ["an object", parseAsString, { goal: "build" }, null],
  ["an array", parseAsArrayOf(parseAsString), ["build"], null],
];

describe("readAttribute", () => {
  it.each(readings)("reads %s", (_, parser, raw, expected) => {
    expect(readAttribute({ key: raw }, "key", parser)).toEqual(expected);
  });

  it("reads a plain string without a parser", () => {
    expect(readAttribute({ name: "Ada" }, "name")).toBe("Ada");
    expect(readAttribute({ name: 7 }, "name")).toBe("7");
  });

  it("is null for a missing attribute", () => {
    expect(readAttribute({}, "onboarding_goal", goals)).toBeNull();
    expect(readAttribute({}, "onboarding_goal")).toBeNull();
  });

  it("is the parser's default for a missing, unreadable or null attribute", () => {
    const withDefault = goals.withDefault("lose");
    expect(readAttribute({}, "goal", withDefault)).toBe("lose");
    expect(readAttribute({ goal: "bulk" }, "goal", withDefault)).toBe("lose");
    expect(readAttribute({ goal: "null" }, "goal", withDefault)).toBe("lose");
    expect(readAttribute({ goal: { a: 1 } }, "goal", withDefault)).toBe("lose");
    expect(readAttribute({ goal: "build" }, "goal", withDefault)).toBe("build");
  });

  it("does not read the prototype", () => {
    expect(readAttribute({}, "toString")).toBeNull();
    expect(readAttribute({}, "constructor", parseAsString)).toBeNull();
  });
});

describe("useUserAttribute reads", () => {
  it("the attribute the host sent, on the first render after its state", async () => {
    const { result } = await mount(() => useUserAttribute("onboarding_goal", goals), {
      onboarding_goal: "endure",
    });
    expect(result.current[0]).toBe("endure");
  });

  it("a plain string without a parser", async () => {
    const { result } = await mount(() => useUserAttribute("name"), { name: "Ada" });
    expect(result.current[0]).toBe("Ada");
  });

  it.each(readings)("%s exactly as readAttribute does", async (_, parser, raw, expected) => {
    const user = { key: raw };
    const { result } = await mount(() => useUserAttribute("key", parser), user);
    expect(result.current[0]).toEqual(expected);
    expect(result.current[0]).toEqual(readAttribute(user, "key", parser));
  });

  it("null for a missing attribute, or the default", async () => {
    const { result } = await mount(() => ({
      bare: useUserAttribute("onboarding_goal", goals)[0],
      fallback: useUserAttribute("onboarding_goal", goals.withDefault("build"))[0],
    }));
    expect(result.current).toEqual({ bare: null, fallback: "build" });
  });

  it("a new value the host sends later", async () => {
    const { result, host } = await mount(() => useUserAttribute("onboarding_goal", goals), {
      onboarding_goal: "lose",
    });
    act(() => host.update({ user: { onboarding_goal: "endure" } }));
    await flush();
    expect(result.current[0]).toBe("endure");
  });

  it("without re-rendering when another attribute changes", async () => {
    let renders = 0;
    const { result, host } = await mount(
      () => {
        renders++;
        return useUserAttribute("onboarding_goal", goals);
      },
      { onboarding_goal: "lose" },
    );
    const before = renders;
    act(() => host.update({ user: { other: "x" } }));
    await flush();
    expect(renders).toBe(before);
    expect(result.current[0]).toBe("lose");
  });

  it("with a parser built inline on every render", async () => {
    const { result, rerender } = await mount(
      () => useUserAttribute("onboarding_goal", parseAsStringEnum(GOALS)),
      { onboarding_goal: "build" },
    );
    rerender();
    expect(result.current[0]).toBe("build");
  });

  it("throws outside a paywall", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useUserAttribute("goal"))).toThrow(
      "Superwall hooks must be used within a SuperwallProvider",
    );
  });
});

describe("useUserAttribute writes", () => {
  it("a value: serialized, sent to the host, and rendered at once", async () => {
    const { result, writes, host } = await mount(() => ({
      goal: useUserAttribute("onboarding_goal", goals),
      user: useUser(),
    }));

    act(() => result.current.goal[1]("build"));

    expect(result.current.goal[0]).toBe("build");
    expect(result.current.user.onboarding_goal).toBe("build");
    expect(writes()).toEqual([[{ key: "onboarding_goal", value: "build" }]]);
    expect(host.state.user.onboarding_goal).toBe("build");
  });

  it.each<[string, Parser<unknown>, unknown, string]>([
    ["an integer, rounded", parseAsInteger, 4.6, "5"],
    ["a float", parseAsFloat, 2.25, "2.25"],
    ["a boolean", parseAsBoolean, false, "false"],
    ["a list", parseAsArrayOf(parseAsInteger), [1, 2], "1,2"],
    ["a custom type", point, { x: 1, y: 2 }, "1:2"],
  ])("%s with the parser's serialize", async (_, parser, value, text) => {
    const { result, writes } = await mount(() => useUserAttribute("key", parser));
    act(() => result.current[1](value as never));
    expect(writes()).toEqual([[{ key: "key", value: text }]]);
    expect(result.current[0]).toEqual(parser.parse(text));
  });

  it("an updater, given the current value", async () => {
    const seen: unknown[] = [];
    const { result } = await mount(() => useUserAttribute("count", parseAsInteger), { count: "2" });
    act(() =>
      result.current[1]((previous) => {
        seen.push(previous);
        return (previous ?? 0) + 1;
      }),
    );
    expect(seen).toEqual([2]);
    expect(result.current[0]).toBe(3);
  });

  it("an updater, given null for a missing attribute and the default with one", async () => {
    const seen: unknown[] = [];
    const { result } = await mount(() => ({
      bare: useUserAttribute("count", parseAsInteger),
      counted: useUserAttribute("counted", parseAsInteger.withDefault(10)),
    }));
    act(() => {
      result.current.bare[1]((previous) => {
        seen.push(previous);
        return 1;
      });
      result.current.counted[1]((previous) => {
        seen.push(previous);
        return previous + 1;
      });
    });
    expect(seen).toEqual([null, 10]);
    expect(result.current.bare[0]).toBe(1);
    expect(result.current.counted[0]).toBe(11);
  });

  it("updaters in one event, each seeing the last", async () => {
    const { result, writes } = await mount(() => useUserAttribute("count", parseAsInteger), {
      count: "0",
    });
    act(() => {
      result.current[1]((previous) => (previous ?? 0) + 1);
      result.current[1]((previous) => (previous ?? 0) + 1);
    });
    expect(result.current[0]).toBe(2);
    expect(writes()).toEqual([[{ key: "count", value: "1" }], [{ key: "count", value: "2" }]]);
  });

  it("nothing for the value already stored", async () => {
    const { result, writes } = await mount(
      () => ({
        goal: useUserAttribute("onboarding_goal", goals),
        age: useUserAttribute("age", parseAsInteger),
      }),
      { onboarding_goal: "build", age: 30 },
    );
    act(() => {
      result.current.goal[1]("build");
      result.current.age[1](30);
    });
    expect(writes()).toEqual([]);
  });

  it("the default when the attribute is missing, since nothing is stored yet", async () => {
    const { result, writes } = await mount(() =>
      useUserAttribute("onboarding_goal", goals.withDefault("lose")),
    );
    act(() => result.current[1]("lose"));
    expect(writes()).toEqual([[{ key: "onboarding_goal", value: "lose" }]]);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
  ])(
    "nothing for %s, with a warning, since a paywall cannot remove an attribute",
    async (_, empty) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { result, writes } = await mount(() => useUserAttribute("onboarding_goal", goals), {
        onboarding_goal: "build",
      });

      act(() => result.current[1](empty as never));
      act(() => result.current[1](() => empty as never));

      expect(writes()).toEqual([]);
      expect(result.current[0]).toBe("build");
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        `useUserAttribute("onboarding_goal") ignored ${String(empty)}: a paywall cannot remove a user attribute.`,
      );
    },
  );

  it("over a stored string null", async () => {
    const { result, writes } = await mount(() => useUserAttribute("onboarding_goal", goals), {
      onboarding_goal: "null",
    });
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]("endure"));
    expect(writes()).toEqual([[{ key: "onboarding_goal", value: "endure" }]]);
    expect(result.current[0]).toBe("endure");
  });

  it("with the parser of the latest render", async () => {
    let parser: Parser<number> = parseAsInteger;
    const { result, rerender, writes } = await mount(() => useUserAttribute("n", parser));
    parser = parseAsFloat;
    rerender();
    act(() => result.current[1](1.25));
    expect(writes()).toEqual([[{ key: "n", value: "1.25" }]]);
  });
});

describe("the setter", () => {
  it("keeps its identity across renders and values", async () => {
    const { result, rerender } = await mount(() => useUserAttribute("onboarding_goal", goals));
    const first = result.current[1];
    act(() => first("build"));
    rerender();
    act(() => result.current[1]("lose"));
    expect(result.current[1]).toBe(first);
    expect(result.current[0]).toBe("lose");
  });

  it("follows the key", async () => {
    let key = "a";
    const { result, rerender, writes } = await mount(() => useUserAttribute(key));
    const first = result.current[1];
    key = "b";
    rerender();
    expect(result.current[1]).not.toBe(first);
    act(() => result.current[1]("x"));
    expect(writes()).toEqual([[{ key: "b", value: "x" }]]);
  });
});

describe("parsers", () => {
  it("are the same objects from superwall/hooks and superwall/navigation", () => {
    for (const name of [
      "createParser",
      "parseAsArrayOf",
      "parseAsBoolean",
      "parseAsFloat",
      "parseAsInteger",
      "parseAsString",
      "parseAsStringEnum",
    ] as const) {
      expect(hooks[name]).toBe(parsers[name]);
      expect(navigation[name]).toBe(parsers[name]);
    }
  });
});

describe("types", () => {
  it("follow the parser", () => {
    expectTypeOf(useUserAttribute).toBeCallableWith("goal");

    const typed = () => {
      const [goal, setGoal] = useUserAttribute("onboarding_goal", goals);
      expectTypeOf(setGoal).toEqualTypeOf<SetUserAttribute<"lose" | "build" | "endure">>();
      expectTypeOf(goal).toEqualTypeOf<"lose" | "build" | "endure" | null>();
      expectTypeOf(setGoal)
        .parameter(0)
        .toEqualTypeOf<
          | "lose"
          | "build"
          | "endure"
          | ((previous: "lose" | "build" | "endure" | null) => "lose" | "build" | "endure")
        >();
      // @ts-expect-error a paywall cannot remove an attribute
      setGoal(null);
      // @ts-expect-error not one of the values
      setGoal("bulk");

      const [count, setCount] = useUserAttribute("count", parseAsInteger.withDefault(0));
      expectTypeOf(count).toEqualTypeOf<number>();
      setCount((previous) => {
        expectTypeOf(previous).toEqualTypeOf<number>();
        return previous + 1;
      });

      const [name] = useUserAttribute("name");
      expectTypeOf(name).toEqualTypeOf<string | null>();

      const [tags] = useUserAttribute("tags", parseAsArrayOf(goals));
      expectTypeOf(tags).toEqualTypeOf<("lose" | "build" | "endure")[] | null>();
    };
    expectTypeOf(typed).toBeFunction();

    expectTypeOf(readAttribute({}, "goal", goals)).toEqualTypeOf<
      "lose" | "build" | "endure" | null
    >();
    expectTypeOf(readAttribute({}, "goal", goals.withDefault("lose"))).toEqualTypeOf<
      "lose" | "build" | "endure"
    >();
    expectTypeOf(readAttribute({}, "name")).toEqualTypeOf<string | null>();
    expectTypeOf<navigation.EntryVariables["user"]>().toMatchTypeOf<UserAttributes>();
  });
});

const Opened = () => {
  const [opened, setOpened] = useUserAttribute("onboarding_opened", parseAsBoolean);
  React.useEffect(() => setOpened(true), [setOpened]);
  return <span>{String(opened)}</span>;
};

const Goal = () => {
  const [goal, setGoal] = useUserAttribute("onboarding_goal", goals);
  return (
    <button type="button" onClick={() => setGoal("endure")}>
      {goal ?? "none"}
    </button>
  );
};

const Toggle = () => {
  const [shown, setShown] = React.useState(true);
  return (
    <>
      <button type="button" onClick={() => setShown((value) => !value)}>
        toggle
      </button>
      {shown ? <Goal /> : null}
    </>
  );
};

describe("useUserAttribute as state", () => {
  const renderPaywall = async (ui: React.ReactElement, user: Record<string, unknown> = {}) => {
    const outgoing: TOutgoingMessage[] = [];
    const { transport, host } = createHost({
      user,
      onOutgoing: (message) => outgoing.push(message),
    });
    const view = render(
      <SuperwallProvider config={testConfig} transport={transport}>
        {ui}
      </SuperwallProvider>,
    );
    await flush();
    return {
      ...view,
      host,
      writes: (): Written[] =>
        outgoing.flatMap((message) =>
          message.event_name === "user_attribute_updated" ? [message.attributes] : [],
        ),
    };
  };

  it("updates every component reading the key in the same commit as the tap", async () => {
    const seen: [string, unknown][] = [];
    const Reader = ({ name }: { name: string }) => {
      const [goal] = useUserAttribute("onboarding_goal", goals);
      seen.push([name, goal]);
      return <span data-testid={name}>{goal ?? "none"}</span>;
    };
    const Picker = () => {
      const [goal, setGoal] = useUserAttribute("onboarding_goal", goals);
      return (
        <button type="button" aria-pressed={goal === "build"} onClick={() => setGoal("build")}>
          pick build
        </button>
      );
    };
    await renderPaywall(
      <>
        <Picker />
        <Reader name="header" />
        <Reader name="footer" />
      </>,
    );
    seen.length = 0;

    fireEvent.click(screen.getByText("pick build"));

    expect(screen.getByText("pick build").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("header").textContent).toBe("build");
    expect(screen.getByTestId("footer").textContent).toBe("build");
    expect(seen).toEqual([
      ["header", "build"],
      ["footer", "build"],
    ]);
  });

  it("reads the new key's value when the key changes", async () => {
    let key = "onboarding_goal";
    const { result, rerender } = await mount(() => useUserAttribute(key, goals), {
      onboarding_goal: "lose",
      other_goal: "endure",
    });
    expect(result.current[0]).toBe("lose");

    key = "other_goal";
    rerender();

    expect(result.current[0]).toBe("endure");
  });

  it("re-reads the stored text when the parser changes", async () => {
    let parser: Parser<unknown> = parseAsString;
    const { result, rerender } = await mount(() => useUserAttribute("count", parser), {
      count: "42",
    });
    expect(result.current[0]).toBe("42");

    parser = parseAsInteger;
    rerender();

    expect(result.current[0]).toBe(42);
  });

  it("hands back the same parsed object until the stored text changes", async () => {
    const list = parseAsArrayOf(goals);
    const { result, rerender, host } = await mount(() => useUserAttribute("goals", list), {
      goals: "lose,build",
    });
    const first = result.current[0];
    rerender();
    expect(result.current[0]).toBe(first);

    act(() => host.update({ user: { goals: "endure" } }));
    await flush();

    expect(result.current[0]).toEqual(["endure"]);
  });

  it("takes the host's value over one the paywall wrote", async () => {
    const { result, host } = await mount(() => useUserAttribute("onboarding_goal", goals));
    act(() => result.current[1]("build"));

    act(() => host.update({ user: { onboarding_goal: "lose" } }));
    await flush();

    expect(result.current[0]).toBe("lose");
  });

  it("writes once in StrictMode, whose effects run twice, after the host's first state", async () => {
    window.history.replaceState({}, "", "/?transport=editor");
    const outgoing: TOutgoingMessage[] = [];
    const { transport } = createHost({ onOutgoing: (message) => outgoing.push(message) });
    render(
      <React.StrictMode>
        <SuperwallProvider config={testConfig} transport={transport}>
          <Opened />
        </SuperwallProvider>
      </React.StrictMode>,
    );
    await flush();

    expect(screen.getByText("true")).not.toBeNull();
    expect(
      outgoing.filter((message) => message.event_name === "user_attribute_updated"),
    ).toHaveLength(1);
    window.history.replaceState({}, "", "/");
  });

  it("settles when written during render, sending the value once", async () => {
    const error = vi.spyOn(console, "error");
    const Eager = () => {
      const [goal, setGoal] = useUserAttribute("onboarding_goal", goals);
      if (goal === null) setGoal("endure");
      return <span>{goal ?? "none"}</span>;
    };
    const { writes } = await renderPaywall(<Eager />);

    expect(screen.getByText("endure")).not.toBeNull();
    expect(writes()).toEqual([[{ key: "onboarding_goal", value: "endure" }]]);
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps a value through a remount, because the host holds it", async () => {
    await renderPaywall(<Toggle />);
    fireEvent.click(screen.getByText("none"));
    fireEvent.click(screen.getByText("toggle"));
    fireEvent.click(screen.getByText("toggle"));

    expect(screen.getByText("endure")).not.toBeNull();
  });
});
