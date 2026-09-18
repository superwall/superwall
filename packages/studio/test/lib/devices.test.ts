import { describe, expect, it } from "vitest";
import {
  chromeFor,
  DEFAULT_DEVICE_ID,
  deviceById,
  deviceVariablesFor,
  isWebOnly,
  STUDIO_DEVICES,
  webViewportFor,
} from "../../src/lib/devices";

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
    expect(STUDIO_DEVICES.some((device) => device.name.includes("Safari"))).toBe(false);
  });

  it("resolves by id and falls back to the default", () => {
    expect(deviceById("pixel-10").name).toBe("Pixel 10");
    expect(deviceById("nokia-3310").id).toBe(DEFAULT_DEVICE_ID);
  });
});

describe("web paywalls", () => {
  it("are the ones whose every platform is web", () => {
    expect(isWebOnly(["web"])).toBe(true);
    expect(isWebOnly(["Web"])).toBe(true);
    expect(isWebOnly(["ios", "web"])).toBe(false);
    expect(isWebOnly([])).toBe(false);
    expect(isWebOnly(undefined)).toBe(false);
  });

  it("show as a bare viewport on any picked device: a browser page has no status bar or island", () => {
    expect(chromeFor(deviceById("iphone-17"), true)).toBeUndefined();
    expect(chromeFor(deviceById("ipad-pro-11"), true)).toBeUndefined();
    expect(chromeFor(deviceById("desktop"), true)).toBeUndefined();
  });

  it("get the viewport a browser leaves, not the whole screen", () => {
    expect(webViewportFor(deviceById("iphone-17"))).toEqual({ width: 402, height: 874 - 64 - 84 });
    expect(webViewportFor(deviceById("pixel-10"))).toEqual({ width: 412, height: 915 - 24 - 104 });
    expect(webViewportFor(deviceById("ipad-pro-11"))).toEqual({
      width: 834,
      height: 1194 - 24 - 66,
    });
    expect(webViewportFor(deviceById("desktop"))).toEqual({ width: 1440, height: 900 - 52 });
  });

  it("leave a native paywall's device untouched", () => {
    expect(chromeFor(deviceById("iphone-17"), false)).toBe(deviceById("iphone-17").chrome);
    expect(chromeFor(deviceById("desktop"), false)).toBeUndefined();
  });

  it("report web as the platform on every device, keeping the hardware", () => {
    expect(deviceVariablesFor(deviceById("pixel-10"), true)).toEqual({
      platform: "web",
      deviceModel: "Pixel 10",
      osVersion: "16",
    });
    expect(deviceVariablesFor(deviceById("desktop"), true)).toEqual({ platform: "web" });
    expect(deviceVariablesFor(deviceById("pixel-10"), false)).toMatchObject({
      platform: "Android",
    });
  });

  it("report the desktop preset as a Mac host to a native paywall, so it has no safe area", () => {
    expect(deviceVariablesFor(deviceById("desktop"), false)).toEqual({
      platform: "iOS",
      deviceModel: "Mac",
      osVersion: "26.0",
      interfaceType: "mac",
    });
  });

  it("reserve the Android navigation bar the way the SDK keeps the webview above it", () => {
    expect(deviceById("pixel-10").chrome?.navigationBarHeight).toBe(24);
    expect(deviceById("iphone-17").chrome?.navigationBarHeight).toBeUndefined();
  });
});
