import { describe, expect, it } from "vitest";
import { webSdkInit } from "../../../src/checkout/host/init";

const hashOf = (payload: unknown) =>
  `#init=${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))}`;

describe("webSdkInit", () => {
  it("reads the api base and placement session token the Web SDK hands the paywall", () => {
    expect(
      webSdkInit(
        hashOf({
          apiBase: "https://web-api.superwall.app",
          placementSessionToken: "pk_web",
          clientSurface: "web-sdk",
          application: { name: "Café" },
        }),
      ),
    ).toEqual({ apiBase: "https://web-api.superwall.app", placementSessionToken: "pk_web" });
  });

  it("is null without an init payload, with half of one, or with one it cannot read", () => {
    expect(webSdkInit("")).toBeNull();
    expect(webSdkInit(hashOf({ apiBase: "https://web-api.superwall.app" }))).toBeNull();
    expect(webSdkInit("#init=not-base64-json")).toBeNull();
  });
});
