import { describe, expect, it, vi } from "vitest";
import {
  checkoutEvents,
  joinAttempt,
  leadOf,
  purchaseEventsFor,
  type PurchaseAttempt,
} from "../../src/checkout/events";

describe("checkoutEvents", () => {
  it("keeps dispatching when one listener throws, and says which event failed", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const after = vi.fn();
    const stopBroken = checkoutEvents.subscribe("SHEET_CLOSE", () => {
      throw new Error("boom");
    });
    const stopAfter = checkoutEvents.subscribe("SHEET_CLOSE", after);

    checkoutEvents.dispatch("SHEET_CLOSE", undefined);
    stopBroken();
    stopAfter();

    expect(after).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[checkout] SHEET_CLOSE listener failed:",
      expect.any(Error),
    );
  });
});

describe("purchaseEventsFor", () => {
  it("delivers an event only to listeners registered before it was emitted", () => {
    const bus = purchaseEventsFor({});
    const late = vi.fn();
    const first = vi.fn(() => {
      bus.on("abandon", late);
    });
    bus.on("abandon", first);
    const payload = { referenceName: "primary" };
    bus.emit("abandon", payload as never);
    expect(first).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    bus.emit("abandon", payload as never);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("keeps calling the other listeners when one throws, and says which event failed", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bus = purchaseEventsFor({});
    const after = vi.fn();
    bus.on("abandon", () => {
      throw new Error("boom");
    });
    bus.on("abandon", after);
    bus.emit("abandon", { referenceName: "primary" } as never);
    expect(after).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[checkout] purchase abandon listener failed:",
      expect.any(Error),
    );
    error.mockRestore();
  });
});

describe("joinAttempt", () => {
  it("merges two groups under one lead, and joining a member again changes nothing", () => {
    const a: PurchaseAttempt = {};
    const b: PurchaseAttempt = {};
    const c: PurchaseAttempt = {};
    const d: PurchaseAttempt = {};
    joinAttempt(a, b);
    joinAttempt(c, d);
    joinAttempt(a, d);
    for (const member of [a, b, c, d]) expect(leadOf(member)).toBe(a);
    expect(a.members).toEqual(new Set([a, b, c, d]));
    expect(c.members).toBeUndefined();
    joinAttempt(b, c);
    expect(a.members?.size).toBe(4);
    joinAttempt(undefined, a);
    joinAttempt(a, undefined);
    expect(a.members?.size).toBe(4);
  });
});
