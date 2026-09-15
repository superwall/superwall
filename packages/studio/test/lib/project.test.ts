import { describe, expect, it } from "vitest";
import { parseProjectPayload } from "../../src/lib/project";

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
          settings: { presentation_style: { type: "DRAWER", height: 60, corner_radius: 20 } },
        },
      ],
    });

    expect(payload.title).toBe("chatgpt");
    expect(payload.diagnostics).toEqual(["a warning"]);
    expect(payload.surfaces[0]?.platforms).toEqual(["ios", "android"]);
    expect(payload.surfaces[0]?.presentation).toEqual({
      style: "drawer",
      height: 60,
      cornerRadius: 20,
    });
  });

  it("keeps the paywall a surface was rebuilt from, and drops a malformed one", () => {
    const payload = parseProjectPayload({
      surfaces: [
        {
          kind: "paywall",
          id: "rebuilt",
          routes: [],
          locales: [],
          origin: { paywallId: "65920", url: "https://runtime.example/doc/abc" },
        },
        { kind: "paywall", id: "odd", routes: [], locales: [], origin: { paywallId: 65920 } },
      ],
    });
    expect(payload.surfaces[0]?.origin).toEqual({
      paywallId: "65920",
      url: "https://runtime.example/doc/abc",
    });
    expect(payload.surfaces[1]).not.toHaveProperty("origin");
  });

  it("keeps the native screen a surface was rebuilt from, and drops an unknown framework", () => {
    const payload = parseProjectPayload({
      surfaces: [
        {
          kind: "paywall",
          id: "update-required",
          routes: [],
          locales: [],
          origin: {
            path: "../App/UpdateRequiredView.swift",
            framework: "swiftui",
            screenshot: "original.png",
          },
        },
        {
          kind: "paywall",
          id: "bare",
          routes: [],
          locales: [],
          origin: { path: "a.dart", framework: "flutter" },
        },
        {
          kind: "paywall",
          id: "odd",
          routes: [],
          locales: [],
          origin: { path: "a.kt", framework: "kotlin" },
        },
        { kind: "paywall", id: "half", routes: [], locales: [], origin: { paywallId: "1" } },
        {
          kind: "paywall",
          id: "typed",
          routes: [],
          locales: [],
          origin: { path: "a.swift", framework: 3 },
        },
      ],
    });
    expect(payload.surfaces[0]?.origin).toEqual({
      path: "../App/UpdateRequiredView.swift",
      framework: "swiftui",
      screenshot: "original.png",
    });
    expect(payload.surfaces[1]?.origin).toEqual({ path: "a.dart", framework: "flutter" });
    expect(payload.surfaces[2]).not.toHaveProperty("origin");
    expect(payload.surfaces[3]).not.toHaveProperty("origin");
    expect(payload.surfaces[4]).not.toHaveProperty("origin");
  });

  it("leaves presentation off a surface whose payload carries none", () => {
    const payload = parseProjectPayload({
      surfaces: [{ kind: "paywall", id: "plain", routes: [], locales: [] }],
    });
    expect(payload.surfaces[0]).not.toHaveProperty("presentation");
  });

  it("takes a surface's products only when every entry is a store identifier", () => {
    const payload = parseProjectPayload({
      surfaces: [
        {
          kind: "paywall",
          id: "good",
          routes: [],
          locales: [],
          products: { monthly: "pro_999_month" },
        },
        { kind: "paywall", id: "numbers", routes: [], locales: [], products: { monthly: 999 } },
        { kind: "paywall", id: "listed", routes: [], locales: [], products: ["pro_999_month"] },
        { kind: "paywall", id: "absent", routes: [], locales: [] },
      ],
    });

    expect(payload.surfaces[0]?.products).toEqual({ monthly: "pro_999_month" });
    expect(payload.surfaces[1]?.products).toEqual({});
    expect(payload.surfaces[2]?.products).toEqual({});
    expect(payload.surfaces[3]?.products).toEqual({});
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
