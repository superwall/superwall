import { describe, expect, it } from "vitest";
import { parseProjectPayload } from "../src/lib/project";

describe("parseProjectPayload", () => {
  it("parses a full payload", () => {
    const payload = parseProjectPayload({
      title: "chatgpt",
      diagnostics: ["a warning"],
      surfaces: [
        {
          kind: "paywall",
          id: "plus-upgrade",
          routes: ["index", "offer"],
          locales: ["en", "es"],
          platforms: ["ios", "android"],
          paywallId: "208540",
        },
      ],
    });

    expect(payload.title).toBe("chatgpt");
    expect(payload.diagnostics).toEqual(["a warning"]);
    expect(payload.surfaces[0]?.platforms).toEqual(["ios", "android"]);
  });

  it("leaves platforms off a surface that declares none, or declares them badly", () => {
    const payload = parseProjectPayload({
      surfaces: [
        { kind: "paywall", id: "silent", routes: [], locales: [] },
        { kind: "paywall", id: "odd", routes: [], locales: [], platforms: [1, "ios"] },
      ],
    });
    expect(payload.surfaces[0]).not.toHaveProperty("platforms");
    expect(payload.surfaces[1]).not.toHaveProperty("platforms");
  });

  it("drops malformed surfaces and variable specs instead of crashing", () => {
    const payload = parseProjectPayload({
      title: 42, // wrong type → default
      surfaces: [
        { kind: "paywall", id: "ok", routes: "nope", locales: [7] },
        { kind: "banner", id: "wrong-kind" },
        { id: "missing-kind" },
        "garbage",
        {
          kind: "funnel",
          id: "partial-vars",
        },
      ],
    });

    expect(payload.title).toBe("superwall");
    expect(payload.diagnostics).toEqual([]);
    expect(payload.surfaces).toHaveLength(2);
    // Wrong-typed fields degrade to safe defaults.
    expect(payload.surfaces[0]).toEqual({
      kind: "paywall",
      id: "ok",
      routes: [],
      locales: [],
      products: {},
      paywallId: undefined,
    });
  });

  it("throws only when the payload itself is not an object", () => {
    expect(() => parseProjectPayload("nope")).toThrow(/not an object/);
    expect(() => parseProjectPayload(null)).toThrow(/not an object/);
    expect(parseProjectPayload({}).surfaces).toEqual([]);
  });
});
