import { describe, expect, it } from "vitest";
import { isScreenOrigin, originOf, parseLock } from "../src/lock";

describe("lock origins", () => {
  it("tells a native screen origin from a dashboard paywall origin", () => {
    const lock = parseLock({
      version: 1,
      apps: {},
      paywalls: {},
      funnels: {},
      origins: {
        "paywall/rebuilt": { paywallId: "65920", url: "https://runtime.example/doc/abc" },
        "paywall/update-required": { path: "../App/UpdateRequiredView.swift", framework: "swiftui" },
      },
    });
    expect(lock).toBeDefined();
    if (!lock) return;
    const paywall = originOf(lock, "paywall", "rebuilt");
    const screen = originOf(lock, "paywall", "update-required");
    expect(paywall && isScreenOrigin(paywall)).toBe(false);
    expect(screen && isScreenOrigin(screen)).toBe(true);
    expect(originOf(lock, "funnel", "rebuilt")).toBeUndefined();
  });
});
