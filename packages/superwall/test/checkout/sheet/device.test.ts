import { describe, expect, it } from "vitest";
import { deviceStylesOf } from "../../../src/checkout/sheet/device";

/**
 * The sheet is drawn against the device's own corner radius and safe area, so
 * it sits flush on the screen it is on rather than floating above it.
 */
describe("deviceStylesOf", () => {
  it("gives the newest Dynamic Island phones the deepest corners", () => {
    expect(deviceStylesOf("iPhone18,1")).toEqual({
      safeAreaOffset: "64px",
      borderRadius: "54px",
    });
  });

  it("uses the shallower Dynamic Island radius for the 15 Pro era", () => {
    expect(deviceStylesOf("iPhone16,1")).toEqual({
      safeAreaOffset: "64px",
      borderRadius: "50px",
    });
  });

  it("gives notched phones their shallower radius", () => {
    expect(deviceStylesOf("iPhone10,3")).toEqual({
      safeAreaOffset: "56px",
      borderRadius: "44px",
    });
  });

  it("squares off the home-button phones, which have no rounded display", () => {
    expect(deviceStylesOf("iPhone8,1")).toEqual({
      safeAreaOffset: "44px",
      borderRadius: "22px",
    });
  });

  it("falls back to notch-like values for anything it does not recognise", () => {
    expect(deviceStylesOf("")).toEqual({ safeAreaOffset: "56px", borderRadius: "44px" });
    expect(deviceStylesOf("Pixel 8")).toEqual({ safeAreaOffset: "56px", borderRadius: "44px" });
  });
});
