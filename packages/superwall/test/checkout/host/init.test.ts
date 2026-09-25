import { describe, expect, it } from "vitest";
import { presentingPlacement, webSdkInit } from "../../../src/checkout/host/init";

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

describe("webSdkInit placement", () => {
  const payload = {
    apiBase: "https://web-api.superwall.app",
    placementSessionToken: "pk_web",
    checkoutContext: {
      presentment: { presentedByEventName: "web_checkout", presentedByEventId: "evt_1" },
    },
  };

  it("reads the placement that presented the paywall", () => {
    expect(webSdkInit(hashOf(payload))).toEqual({
      apiBase: "https://web-api.superwall.app",
      placementSessionToken: "pk_web",
      presentedByEventName: "web_checkout",
      presentedByEventId: "evt_1",
    });
  });

  it("prefers a native event_name, else falls back to the Web SDK placement", () => {
    window.location.hash = hashOf(payload);
    expect(presentingPlacement({ event_name: "campaign_trigger", event_id: "n1" })).toEqual({
      name: "campaign_trigger",
      eventId: "n1",
    });
    expect(presentingPlacement({})).toEqual({ name: "web_checkout", eventId: "evt_1" });
    window.location.hash = "";
    expect(presentingPlacement({})).toEqual({ name: "", eventId: "" });
  });
});
