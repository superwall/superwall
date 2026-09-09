import { describe, expect, it, vi } from "vitest";
import { checkoutEvents } from "../../src/checkout/events";

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
