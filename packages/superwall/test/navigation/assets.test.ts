import { afterEach, describe, expect, it, vi } from "vitest";
import { whenIdle } from "../../src/navigation/assets";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("whenIdle", () => {
  it("uses the idle callback where the browser has one, and cancels it", () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn(() => 7),
    );
    vi.stubGlobal("cancelIdleCallback", cancel);

    const run = vi.fn();
    whenIdle(run)();

    expect(window.requestIdleCallback).toHaveBeenCalledWith(run);
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("falls back to a timer where it does not", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);

    const run = vi.fn();
    const stop = whenIdle(run);
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledOnce();

    const stopSecond = whenIdle(run);
    stopSecond();
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledOnce();
    stop();
  });
});
