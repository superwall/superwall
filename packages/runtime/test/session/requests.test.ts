import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callbackStateName,
  createRequestId,
  createRequestTracker,
  permissionStateName,
} from "../../src/session/requests";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("naming", () => {
  it("camelCases permission types the way paywall.js stores them", () => {
    expect(permissionStateName("background_location")).toBe("backgroundLocation");
    expect(permissionStateName("notification")).toBe("notification");
  });

  it("camelCases callback names and falls back to 'callback'", () => {
    expect(callbackStateName("sync entitlements!")).toBe("syncEntitlements");
    expect(callbackStateName("Server Push")).toBe("serverPush");
    expect(callbackStateName("!!!")).toBe("callback");
  });

  it("prefixes request ids and survives a runtime without randomUUID", () => {
    expect(createRequestId("permission-camera")).toMatch(/^permission-camera-[0-9a-f-]{36}$/);
    vi.stubGlobal("crypto", {});
    expect(createRequestId("x")).toMatch(/^x-[a-z0-9]+$/);
  });
});

describe("createRequestTracker", () => {
  it("correlates a permission result with its request", async () => {
    const tracker = createRequestTracker();
    const { requestId, result } = tracker.permission("notification");

    tracker.resolvePermission({
      event_name: "permission_result",
      permission_type: "notification",
      request_id: "someone-else",
      status: "denied",
    });
    tracker.resolvePermission({
      event_name: "permission_result",
      permission_type: "notification",
      request_id: requestId,
      status: "granted",
    });

    await expect(result).resolves.toBe("granted");
  });

  it("correlates a callback result and reports the request's name", async () => {
    const tracker = createRequestTracker();
    const { requestId, result } = tracker.callback("sync entitlements", "non-blocking");
    expect(requestId).toMatch(/^syncEntitlements-non-blocking-/);

    const message = {
      event_name: "callback_result" as const,
      request_id: requestId,
      name: "sync entitlements",
      status: "success" as const,
      data: { synced: true },
    };
    expect(tracker.resolveCallback({ ...message, request_id: "unknown" })).toBeUndefined();
    expect(tracker.resolveCallback(message)).toBe("sync entitlements");

    await expect(result).resolves.toEqual({ status: "success", data: { synced: true }, message });
  });
});
