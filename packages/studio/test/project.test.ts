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
          pageRoutes: ["/", "/offer"],
          locales: ["en", "es"],
          paywallId: "208540",
          variables: {
            plan: { type: "enum", values: ["go", "plus"], default: "plus", label: "Plan" },
            web: { type: "boolean", default: true },
            max: { type: "number", default: 5, min: 1, max: 10 },
            headline: { type: "string", default: "Go" },
          },
        },
      ],
    });

    expect(payload.title).toBe("chatgpt");
    expect(payload.diagnostics).toEqual(["a warning"]);
    expect(payload.surfaces[0].variables).toEqual({
      plan: { type: "enum", values: ["go", "plus"], default: "plus", label: "Plan" },
      web: { type: "boolean", default: true, label: undefined },
      max: { type: "number", default: 5, min: 1, max: 10, label: undefined },
      headline: { type: "string", default: "Go", label: undefined },
    });
  });

  it("drops malformed surfaces and variable specs instead of crashing", () => {
    const payload = parseProjectPayload({
      title: 42, // wrong type → default
      surfaces: [
        { kind: "paywall", id: "ok", pageRoutes: "nope", locales: [7] },
        { kind: "banner", id: "wrong-kind" },
        { id: "missing-kind" },
        "garbage",
        {
          kind: "funnel",
          id: "partial-vars",
          variables: {
            good: { type: "boolean", default: false },
            badEnum: { type: "enum", values: [1, 2], default: "x" },
            badNumber: { type: "number", default: "five" },
            unknownType: { type: "color", default: "#fff" },
          },
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
      pageRoutes: [],
      locales: [],
      variables: undefined,
      paywallId: undefined,
    });
    // Only the valid spec survives.
    expect(payload.surfaces[1].variables).toEqual({
      good: { type: "boolean", default: false, label: undefined },
    });
  });

  it("throws only when the payload itself is not an object", () => {
    expect(() => parseProjectPayload("nope")).toThrow(/not an object/);
    expect(() => parseProjectPayload(null)).toThrow(/not an object/);
    expect(parseProjectPayload({}).surfaces).toEqual([]);
  });
});
