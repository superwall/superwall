import { describe, expect, it } from "vitest";
import {
  InitializationParamsSchema,
  ParameterNames,
  Platform,
  TransportKind,
} from "../src/initializationParams";

describe("InitializationParamsSchema", () => {
  it("defaults to the WebKit transport on iOS", () => {
    const params = InitializationParamsSchema.parse({});
    expect(params.transport).toBe(TransportKind.WebKitPostMessage);
    expect(params.platform).toBe(Platform.iOS);
    expect(params.enableEditorHover).toBe(false);
  });

  it("accepts every declared transport kind", () => {
    for (const transport of Object.values(TransportKind)) {
      expect(InitializationParamsSchema.parse({ transport }).transport).toBe(transport);
    }
  });

  it("coerces enableEditorHover from its string form", () => {
    expect(InitializationParamsSchema.parse({ enableEditorHover: "true" }).enableEditorHover).toBe(
      true,
    );
    expect(InitializationParamsSchema.parse({ enableEditorHover: "false" }).enableEditorHover).toBe(
      false,
    );
  });

  it("rejects unknown transports", () => {
    expect(InitializationParamsSchema.safeParse({ transport: "carrier-pigeon" }).success).toBe(
      false,
    );
  });

  it("exposes the SDK query parameter names", () => {
    expect(ParameterNames).toContain("transport");
    expect(ParameterNames).toContain("platform");
    expect(ParameterNames).toContain("sdkVersion");
  });
});
