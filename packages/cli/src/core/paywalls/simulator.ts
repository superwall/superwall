import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import type { Renderer } from "@/ui";

export interface BootedSimulator {
  udid: string;
  name: string;
}

export interface SimulatorRuntime {
  booted: () => Promise<BootedSimulator | undefined>;
  screenshot: (udid: string) => Promise<string | undefined>;
}

const simctl = (args: string[]): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile("xcrun", ["simctl", ...args], { timeout: 15_000 }, (error, stdout) => {
      resolve(error ? undefined : String(stdout));
    });
  });

export const simulator: SimulatorRuntime = {
  booted: async () => {
    if (os.platform() !== "darwin") return undefined;
    const output = await simctl(["list", "devices", "booted", "-j"]);
    if (output === undefined) return undefined;
    try {
      const parsed = JSON.parse(output) as { devices?: Record<string, Array<{ udid?: string; name?: string; state?: string }>> };
      for (const list of Object.values(parsed.devices ?? {})) {
        const device = list.find((entry) => entry.state === "Booted" && typeof entry.udid === "string");
        if (device?.udid) return { udid: device.udid, name: device.name ?? device.udid };
      }
    } catch {
      return undefined;
    }
    return undefined;
  },
  screenshot: async (udid) => {
    const file = path.join(os.tmpdir(), `superwall-original-${Date.now()}.png`);
    const output = await simctl(["io", udid, "screenshot", file]);
    return output === undefined ? undefined : file;
  },
};

export async function askForScreenshot(
  ui: Renderer,
  runtime: SimulatorRuntime = simulator,
): Promise<string | undefined> {
  const booted = await runtime.booted();
  if (booted === undefined) return undefined;
  const capture = await ui.confirm({
    message: `Capture \`${booted.name}\` as the original? Show the screen in the simulator first.`,
    initial: true,
  });
  if (capture !== true) return undefined;
  const file = await runtime.screenshot(booted.udid);
  if (file === undefined) {
    ui.warn("The simulator screenshot failed — review against the running app instead.");
    return undefined;
  }
  ui.step(`Captured \`${booted.name}\``);
  return file;
}
