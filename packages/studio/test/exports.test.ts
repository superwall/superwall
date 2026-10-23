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
      "Canvas",
      "useCanvasScale",
      "percent",
      "deviceVariablesFor",
      "chromeFor",
      "isWebOnly",
      "webViewportFor",
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

  it("hosts through one implementation, not a re-exported copy", async () => {
    const host = await import("@superwall/host");

    expect(studio.createHostState).toBe(host.createHostState);
    expect(studio.diffHostState).toBe(host.diffHostState);
    expect(studio.silentDelegate).toBe(host.silentDelegate);
  });
});
