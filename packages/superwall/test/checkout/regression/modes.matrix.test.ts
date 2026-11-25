import { describe, expect, it, vi } from "vitest";
import type { SuperwallRuntimeSnapshot } from "@superwall/runtime";

const state = vi.hoisted(() => ({ host: "sdk" as string, teleport: false }));

vi.mock("../../../src/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/host")>()),
  hostOf: () => state.host,
}));
vi.mock("../../../src/checkout/teleport/boot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/checkout/teleport/boot")>()),
  readTeleportBoot: () => (state.teleport ? { token: "t" } : undefined),
}));

const { checkoutModeFor } = await import("../../../src/checkout/host/sdk");

const VERSIONS = [
  undefined,
  "004.009.000",
  "004.010.007",
  "004.010.008",
  "004.013.999",
  "004.014.000",
  "005.000.000",
];
const PLATFORMS = ["iOS", "Android", "web", undefined];
const HOSTS = ["sdk", "web-sdk"];

const snapshot = (
  checkout: string,
  platform: string | undefined,
  version: string | undefined,
): SuperwallRuntimeSnapshot =>
  ({
    device: {
      ...(platform ? { platform } : {}),
      ...(version ? { sdkVersionPadded: version } : {}),
    },
    config: { checkout },
  }) as never;

describe("the elements mode resolves wherever Apple Pay does, and nowhere else", () => {
  for (const host of HOSTS) {
    for (const teleport of [false, true]) {
      for (const platform of PLATFORMS) {
        for (const version of VERSIONS) {
          it(`${host}${teleport ? " teleport page" : ""} on ${platform ?? "no platform"}, SDK ${version ?? "unknown"}`, () => {
            state.host = host;
            state.teleport = teleport;
            const wallet = checkoutModeFor(snapshot("applePay", platform, version));
            const form = checkoutModeFor(snapshot("elements", platform, version));
            expect(form).toBe(wallet === "applePay" ? "elements" : wallet);
            expect(checkoutModeFor(snapshot("elements", platform, version), "applePay")).toBe(
              wallet,
            );
          });
        }
      }
    }
  }
});
