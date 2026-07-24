import { describe, expect, it } from "vitest";
import { resolveVariables, v } from "../../src";

const schema = {
  plan: v.enum(["go", "plus"], { default: "plus" }),
  showWeb: v.boolean({ default: true }),
  maxFeatures: v.number({ default: 5, min: 1, max: 10 }),
  headline: v.string({ default: "Go further" }),
};

const setUrl = (query: string) => window.history.replaceState({}, "", `/${query}`);

describe("resolveVariables", () => {
  it("returns declared defaults", () => {
    expect(resolveVariables(schema)).toEqual({
      plan: "plus",
      showWeb: true,
      maxFeatures: 5,
      headline: "Go further",
    });
  });

  it("applies explicit overrides", () => {
    expect(resolveVariables(schema, { plan: "go" })).toMatchObject({ plan: "go" });
  });

  it("applies the ambient sw_vars URL channel over everything", () => {
    setUrl(`?sw_vars=${encodeURIComponent(JSON.stringify({ plan: "go", showWeb: false }))}`);
    expect(resolveVariables(schema, { plan: "plus" })).toMatchObject({
      plan: "go",
      showWeb: false,
    });
  });

  it("drops ambient values that don't satisfy their spec", () => {
    setUrl(
      `?sw_vars=${encodeURIComponent(
        JSON.stringify({
          plan: "enterprise", // not in the enum
          showWeb: "yes", // wrong type
          maxFeatures: 99, // out of range
          unknownKey: "ignored", // not in the schema
        }),
      )}`,
    );
    expect(resolveVariables(schema)).toEqual({
      plan: "plus",
      showWeb: true,
      maxFeatures: 5,
      headline: "Go further",
    });
  });

  it("survives malformed sw_vars payloads", () => {
    setUrl("?sw_vars=not-json");
    expect(resolveVariables(schema)).toMatchObject({ plan: "plus" });

    setUrl(`?sw_vars=${encodeURIComponent(JSON.stringify(["an", "array"]))}`);
    expect(resolveVariables(schema)).toMatchObject({ plan: "plus" });
  });
});
