import { describe, expect, it } from "vitest";
import { DEFAULT_DEVICE_ID, deviceById, STUDIO_DEVICES } from "../../src/lib/devices";

describe("device catalog", () => {
  it("has unique ids and sane viewports", () => {
    const ids = STUDIO_DEVICES.map((device) => device.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const device of STUDIO_DEVICES) {
      expect(device.width).toBeGreaterThan(300);
      expect(device.height).toBeGreaterThan(device.width / 2);
      if (device.device) expect(device.device.deviceModel.length).toBeGreaterThan(0);
    }
  });

  it("covers both platforms, desktop, and includes the default", () => {
    const platforms = new Set(
      STUDIO_DEVICES.flatMap((device) => (device.device ? [device.device.platform] : [])),
    );
    expect(platforms).toEqual(new Set(["iOS", "Android"]));
    expect(STUDIO_DEVICES.some((device) => device.device === undefined)).toBe(true);
    expect(STUDIO_DEVICES.some((device) => device.id === DEFAULT_DEVICE_ID)).toBe(true);
  });

  it("resolves by id and falls back to the default", () => {
    expect(deviceById("pixel-10").name).toBe("Pixel 10");
    expect(deviceById("nokia-3310").id).toBe(DEFAULT_DEVICE_ID);
  });
});
