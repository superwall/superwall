import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutEvents } from "../../../src/checkout/events";
import {
  PAINT_FALLBACK_MS,
  TELEPORT_MARKS,
  afterPaint,
  markTeleportPage,
  markTeleportScriptStart,
  watchTeleportPageTiming,
} from "../../../src/checkout/teleport/timing";

const onTeleportPage = () =>
  Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout" });
const marks = (name: string) => performance.getEntriesByName(name, "mark");

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
  performance.clearMarks();
});

describe("teleport page timing", () => {
  it("marks nothing on a page that isn't a teleport page", () => {
    markTeleportScriptStart();
    const stop = watchTeleportPageTiming();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: "cs_1" });
    stop();
    expect(performance.getEntriesByType("mark")).toEqual([]);
  });

  it("marks script start, first render and payment form ready, in that order", () => {
    onTeleportPage();
    markTeleportScriptStart();
    const stop = watchTeleportPageTiming();
    expect(marks(TELEPORT_MARKS.paymentReady)).toEqual([]);
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: "cs_1" });
    stop();
    const [script, render, payment] = [
      TELEPORT_MARKS.scriptStart,
      TELEPORT_MARKS.firstRender,
      TELEPORT_MARKS.paymentReady,
    ].map((name) => marks(name)[0]?.startTime);
    expect(script).toBeTypeOf("number");
    expect(render).toBeGreaterThanOrEqual(script!);
    expect(payment).toBeGreaterThanOrEqual(render!);
  });

  it("keeps the first of each mark, so a re-render or a second checkout doesn't move it", () => {
    onTeleportPage();
    const stop = watchTeleportPageTiming();
    stop();
    const again = watchTeleportPageTiming();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: "cs_1" });
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: "cs_2" });
    again();
    expect(marks(TELEPORT_MARKS.firstRender)).toHaveLength(1);
    expect(marks(TELEPORT_MARKS.paymentReady)).toHaveLength(1);
  });

  it("stops listening for the payment form once unwatched", () => {
    onTeleportPage();
    watchTeleportPageTiming()();
    checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: "cs_1" });
    expect(marks(TELEPORT_MARKS.paymentReady)).toEqual([]);
  });

  it("never throws where the browser has no performance timeline", () => {
    onTeleportPage();
    vi.stubGlobal("performance", undefined);
    try {
      expect(() => markTeleportPage(TELEPORT_MARKS.scriptStart)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never throws when the browser refuses a mark", () => {
    onTeleportPage();
    vi.spyOn(performance, "mark").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => markTeleportPage(TELEPORT_MARKS.scriptStart)).not.toThrow();
  });
});

const fake = () =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
  });

describe("afterPaint", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs in the task after the next frame, not in the frame itself", () => {
    fake();
    const callback = vi.fn();
    let inFrame = false;
    afterPaint(callback);
    requestAnimationFrame(() => {
      inFrame = callback.mock.calls.length === 0;
    });
    vi.advanceTimersToNextFrame();
    expect(inFrame).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PAINT_FALLBACK_MS);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("runs on the fallback timer when no frame comes", () => {
    fake();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    const callback = vi.fn();
    afterPaint(callback);
    vi.advanceTimersByTime(PAINT_FALLBACK_MS - 1);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("runs on the fallback timer where the browser has no requestAnimationFrame", () => {
    fake();
    vi.stubGlobal("requestAnimationFrame", undefined);
    try {
      const callback = vi.fn();
      afterPaint(callback);
      vi.advanceTimersByTime(PAINT_FALLBACK_MS);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never runs once cancelled, before or after the frame", () => {
    fake();
    const early = vi.fn();
    afterPaint(early)();
    const late = vi.fn();
    const stop = afterPaint(late);
    vi.advanceTimersToNextFrame();
    stop();
    vi.advanceTimersByTime(PAINT_FALLBACK_MS);
    expect(early).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
  });
});
