import { describe, expect, it } from "vitest";
import { cutoutOf, idiomOf, platformOf } from "../src/device";

describe("platformOf", () => {
  it("reads the host's platform in whichever case it arrives", () => {
    expect(platformOf({ platform: "iOS" })).toBe("ios");
    expect(platformOf({ platform: "Android" })).toBe("android");
    expect(platformOf({ platform: "web" })).toBe("web");
  });

  it("names nothing for a host it does not know", () => {
    expect(platformOf({})).toBeUndefined();
    expect(platformOf({ platform: "visionOS" })).toBeUndefined();
  });
});

describe("idiomOf", () => {
  it("trusts the interface type the SDK reports", () => {
    expect(idiomOf({ interfaceType: "iphone" })).toBe("phone");
    expect(idiomOf({ interfaceType: "ipad" })).toBe("tablet");
    expect(idiomOf({ interfaceType: "mac" })).toBe("desktop");
    expect(idiomOf({ isMac: true })).toBe("desktop");
  });

  it("falls back to the device model, and to nothing", () => {
    expect(idiomOf({ deviceModel: "iPad16,3" })).toBe("tablet");
    expect(idiomOf({ deviceModel: "iPhone18,3" })).toBe("phone");
    expect(idiomOf({ deviceModel: "Pixel 10" })).toBeUndefined();
    expect(idiomOf({})).toBeUndefined();
  });
});

describe("cutoutOf", () => {
  it("classifies iPhones by what the screen makes room for", () => {
    expect(cutoutOf("iPhone14,6")).toBe("none");
    expect(cutoutOf("iPhone10,1")).toBe("none");
    expect(cutoutOf("iPhone10,3")).toBe("notch");
    expect(cutoutOf("iPhone14,7")).toBe("notch");
    expect(cutoutOf("iPhone15,2")).toBe("island");
    expect(cutoutOf("iPhone18,3")).toBe("island");
  });

  it("assumes an island for an iPhone newer than it knows", () => {
    expect(cutoutOf("iPhone25,1")).toBe("island");
  });

  it("says nothing about anything that is not an iPhone", () => {
    expect(cutoutOf("iPad16,3")).toBeUndefined();
    expect(cutoutOf("Pixel 10")).toBeUndefined();
    expect(cutoutOf("")).toBeUndefined();
    expect(cutoutOf(undefined)).toBeUndefined();
  });
});
