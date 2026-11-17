import { describe, expect, it, vi } from "vitest";
import { createStatusStore } from "../../../src/checkout/teleport/teleporter";

describe("createStatusStore", () => {
  it("hands the data to every listener when an earlier one throws, and says which event failed", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createStatusStore({ status: "idle" });
    store.on("data", () => {
      throw new Error("boom");
    });
    const after = vi.fn();
    store.on("data", after);
    store.emit("data", { offer: "app_store" });
    expect(after).toHaveBeenCalledExactlyOnceWith({ offer: "app_store" });
    expect(error).toHaveBeenCalledWith("[teleport] data listener failed:", expect.any(Error));
    error.mockRestore();
  });
});
