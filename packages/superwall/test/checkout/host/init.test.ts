import { afterEach, describe, expect, it } from "vitest";
import { presentingPlacement, webSdkPlacement } from "../../../src/checkout/host/init";

const hashOf = (payload: unknown) =>
  `#init=${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))}`;

const payload = {
  apiBase: "https://web-api.superwall.app",
  placementSessionToken: "pk_web",
  checkoutContext: {
    presentment: { presentedByEventName: "web_checkout", presentedByEventId: "evt_1" },
  },
};

afterEach(() => {
  window.location.hash = "";
});

describe("webSdkPlacement", () => {
  it("reads the placement the Web SDK names in its init payload", () => {
    expect(webSdkPlacement(hashOf(payload))).toEqual({ name: "web_checkout", eventId: "evt_1" });
  });

  it("is empty without an init payload, without a placement, or with one it cannot read", () => {
    const none = { name: "", eventId: "" };
    expect(webSdkPlacement("")).toEqual(none);
    expect(webSdkPlacement(hashOf({ apiBase: "https://web-api.superwall.app" }))).toEqual(none);
    expect(webSdkPlacement("#init=not-base64-json")).toEqual(none);
  });
});

describe("presentingPlacement", () => {
  it("prefers a native event_name, else falls back to the Web SDK placement", () => {
    window.location.hash = hashOf(payload);
    expect(presentingPlacement({ event_name: "campaign_trigger", event_id: "n1" })).toEqual({
      name: "campaign_trigger",
      eventId: "n1",
    });
    expect(presentingPlacement({ event_name: 7 })).toEqual({
      name: "web_checkout",
      eventId: "evt_1",
    });
    window.location.hash = "";
    expect(presentingPlacement({})).toEqual({ name: "", eventId: "" });
  });
});
