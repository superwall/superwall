import { describe, expect, it } from "vitest";
import * as studio from "../src/index";

/**
 * The dashboard consumes this package as a vendored build, so a name it needs is
 * either exported here or hand-rolled over there — which is how it ended up with
 * its own copy of the paywall postMessage envelope.
 */
describe("what a second host can reach", () => {
  it("exports the pieces needed to host a paywall in someone else's app", () => {
    for (const name of [
      "HostedIframe",
      "DeviceFrame",
      "hostStateFor",
      "studioDefaults",
      "createHostState",
      "diffHostState",
      "silentDelegate",
      "createStudioDelegate",
      "hostedUrl",
      "snapshotPreviewUrl",
    ]) {
      expect(studio, name).toHaveProperty(name);
    }
  });

  it("exports the stage and device helpers a preview card draws a paywall with", async () => {
    const canvas = await import("../src/components/preview/Canvas");
    const devices = await import("../src/lib/devices");

    expect(studio.Canvas).toBe(canvas.Canvas);
    expect(studio.useCanvasScale).toBe(canvas.useCanvasScale);
    expect(studio.percent(0.5)).toBe("50%");
    expect(studio.chromeFor).toBe(devices.chromeFor);
    expect(studio.deviceVariablesFor).toBe(devices.deviceVariablesFor);
    expect(studio.isWebOnly(["web"])).toBe(true);
    expect(studio.webViewportFor).toBe(devices.webViewportFor);
  });

  it("hosts through one implementation, not a re-exported copy", async () => {
    const host = await import("@superwall/host");

    expect(studio.createHostState).toBe(host.createHostState);
    expect(studio.diffHostState).toBe(host.diffHostState);
    expect(studio.silentDelegate).toBe(host.silentDelegate);
  });
});
