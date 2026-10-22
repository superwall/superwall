import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createParser,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  parseValue,
  type Parser,
  type ParserWithDefault,
} from "../src/parsers";

const goals = parseAsStringEnum(["lose", "build", "endure"]);

describe("parseValue", () => {
  it("parses a present value", () => {
    expect(parseValue(goals, "build")).toBe("build");
    expect(parseValue(parseAsInteger, "7")).toBe(7);
  });

  it("is null for a missing or unreadable value without a default", () => {
    expect(parseValue(goals, null)).toBeNull();
    expect(parseValue(goals, "bulk")).toBeNull();
  });

  it("is the default for a missing or unreadable value", () => {
    const parser = goals.withDefault("lose");
    expect(parseValue(parser, null)).toBe("lose");
    expect(parseValue(parser, "bulk")).toBe("lose");
    expect(parseValue(parser, "endure")).toBe("endure");
  });

  it("keeps a falsy value a parser read", () => {
    expect(parseValue(parseAsInteger.withDefault(5), "0")).toBe(0);
    expect(parseValue(parseAsString.withDefault("x"), "")).toBe("");
  });
});

describe("parsers", () => {
  it("keep their default through withOptions", () => {
    const parser = goals.withDefault("build").withOptions({ history: "push" });
    expect(parser.defaultValue).toBe("build");
    expect(parser.history).toBe("push");
    expect(parseValue(parser, null)).toBe("build");
  });

  it("default serialize to String and eq to Object.is", () => {
    const parser = createParser<number>({ parse: Number });
    expect(parser.serialize(1.5)).toBe("1.5");
    expect(parser.eq(Number.NaN, Number.NaN)).toBe(true);
  });

  it("are typed by what they read", () => {
    expectTypeOf(goals).toEqualTypeOf<Parser<"lose" | "build" | "endure">>();
    expectTypeOf(goals.withDefault("lose")).toEqualTypeOf<
      ParserWithDefault<"lose" | "build" | "endure">
    >();
    expectTypeOf(parseAsArrayOf(goals)).toEqualTypeOf<Parser<("lose" | "build" | "endure")[]>>();
    expectTypeOf(parseValue(goals, null)).toEqualTypeOf<"lose" | "build" | "endure" | null>();
    // @ts-expect-error a default must be one of the values
    goals.withDefault("bulk");
  });
});
