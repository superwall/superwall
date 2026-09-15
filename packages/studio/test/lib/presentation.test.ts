import { describe, expect, it } from "vitest";
import {
  modalHeightPercent,
  parsePresentation,
  presentationRect,
} from "../../src/lib/presentation";

const phone = { width: 402, height: 874 };
const tablet = { width: 834, height: 1194 };

describe("presentationRect", () => {
  it("lets fullscreen, push and no-animation paywalls fill the device", () => {
    for (const style of ["fullscreen", "push", "noAnimation"] as const) {
      expect(presentationRect({ style }, phone)).toBeUndefined();
    }
    expect(presentationRect(undefined, phone)).toBeUndefined();
  });

  it("shows a modal as a bottom sheet on a phone, with the page peeking out behind", () => {
    const rect = presentationRect({ style: "modal" }, phone);
    const expectedHeight = Math.round((phone.height * modalHeightPercent(402, 874)) / 100);
    expect(rect).toEqual({
      x: 0,
      y: phone.height - expectedHeight,
      width: phone.width,
      height: expectedHeight,
      radius: { top: 15, bottom: 0 },
      underlay: true,
    });
    expect(modalHeightPercent(393, 852)).toBeCloseTo(91.9, 1);
  });

  it("centres a modal on a tablet instead", () => {
    const rect = presentationRect({ style: "modal" }, tablet);
    expect(rect).toMatchObject({ width: 584, height: 955, underlay: false });
    expect(rect?.x).toBe(125);
    expect(rect?.radius).toEqual({ top: 15, bottom: 15 });
  });

  it("sizes a drawer from its declared height and radius, defaulting like the SDK", () => {
    expect(presentationRect({ style: "drawer" }, phone)).toMatchObject({
      y: phone.height - 612,
      height: 612,
      radius: { top: 15, bottom: 0 },
      underlay: false,
    });
    expect(
      presentationRect({ style: "drawer", height: 50, cornerRadius: 24 }, phone),
    ).toMatchObject({ height: 437, radius: { top: 24, bottom: 0 } });
  });

  it("centres a popup at its declared size", () => {
    expect(presentationRect({ style: "popup" }, phone)).toMatchObject({
      x: 40,
      width: 322,
      height: 524,
      radius: { top: 15, bottom: 15 },
    });
    expect(
      presentationRect({ style: "popup", width: 50, height: 50, cornerRadius: 8 }, phone),
    ).toMatchObject({ x: 101, y: 219, width: 201, height: 437, radius: { top: 8, bottom: 8 } });
  });
});

describe("parsePresentation", () => {
  it("reads the wire shape the framework builds, geometry included", () => {
    expect(parsePresentation({ type: "FULLSCREEN" })).toEqual({ style: "fullscreen" });
    expect(parsePresentation({ type: "NO_ANIMATION" })).toEqual({ style: "noAnimation" });
    expect(parsePresentation({ type: "DRAWER", height: 70, corner_radius: 15 })).toEqual({
      style: "drawer",
      height: 70,
      cornerRadius: 15,
    });
    expect(parsePresentation({ type: "POPUP", width: 80, height: 60, corner_radius: 12 })).toEqual({
      style: "popup",
      width: 80,
      height: 60,
      cornerRadius: 12,
    });
  });

  it("ignores what it does not recognise rather than guessing", () => {
    expect(parsePresentation(undefined)).toBeUndefined();
    expect(parsePresentation({ type: "CAROUSEL" })).toBeUndefined();
    expect(parsePresentation({ type: "DRAWER", height: -1 })).toEqual({ style: "drawer" });
  });
});
