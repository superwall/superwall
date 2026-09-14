import { describe, expect, it } from "vitest";
import {
  centered,
  fitTransform,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  percent,
  stepScale,
  zoomAt,
} from "../../src/lib/canvas";

const viewport = { width: 1000, height: 800 };

describe("fitTransform", () => {
  it("scales content down to fit inside the insets and centres it within them", () => {
    const fitted = fitTransform({ width: 2000, height: 1000 }, viewport);
    expect(fitted.scale).toBeCloseTo((1000 - 96) / 2000);
    expect(fitted.x).toBeCloseTo(48 + (904 - 2000 * fitted.scale) / 2);
    expect(fitted.y).toBeCloseTo(48 + (704 - 1000 * fitted.scale) / 2);
  });

  it("keeps a tall frame inside the vertical inset", () => {
    const tall = fitTransform({ width: 100, height: 1000 }, viewport);
    expect(tall.scale).toBeCloseTo(704 / 1000);
    expect(tall.y).toBeCloseTo(48);
  });

  it("never scales content up past actual size", () => {
    const fitted = fitTransform({ width: 400, height: 300 }, viewport);
    expect(fitted).toEqual({ scale: 1, x: 300, y: 250 });
  });

  it("is a no-op transform until both sides have been measured", () => {
    expect(fitTransform({ width: 0, height: 0 }, viewport)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(fitTransform({ width: 400, height: 300 }, { width: 0, height: 0 })).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed", () => {
    const before = { scale: 1, x: 100, y: 50 };
    const cursor = { x: 400, y: 300 };
    const contentPoint = { x: (cursor.x - before.x) / before.scale, y: (cursor.y - before.y) / before.scale };
    const after = zoomAt(before, 2, cursor);
    expect(after.scale).toBe(2);
    expect(after.x + contentPoint.x * after.scale).toBeCloseTo(cursor.x);
    expect(after.y + contentPoint.y * after.scale).toBeCloseTo(cursor.y);
  });

  it("clamps to the zoom range", () => {
    expect(zoomAt({ scale: 3, x: 0, y: 0 }, 10, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: 0.2, x: 0, y: 0 }, 0.01, { x: 0, y: 0 }).scale).toBe(MIN_SCALE);
  });
});

describe("steps and helpers", () => {
  it("steps a quarter up or down from wherever the zoom is, to whole percents", () => {
    expect(stepScale(1, 1)).toBe(1.25);
    expect(stepScale(1, -1)).toBe(0.8);
    expect(stepScale(0.6, 1)).toBe(0.75);
    expect(stepScale(0.6, -1)).toBe(0.48);
    expect(stepScale(0.452, 1)).toBe(0.57);
    expect(stepScale(4, 1)).toBe(MAX_SCALE);
    expect(stepScale(0.1, -1)).toBe(MIN_SCALE);
  });

  it("pans, centres and formats", () => {
    expect(panBy({ scale: 1, x: 10, y: 10 }, 5, -5)).toEqual({ scale: 1, x: 15, y: 5 });
    expect(centered(1, { width: 400, height: 300 }, viewport)).toEqual({ scale: 1, x: 300, y: 250 });
    expect(percent(0.519)).toBe("52%");
  });
});
