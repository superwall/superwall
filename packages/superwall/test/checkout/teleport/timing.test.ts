import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutEvents } from "../../../src/checkout/events";
import {
  TELEPORT_MARKS,
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

  it("never throws when the browser refuses a mark", () => {
    onTeleportPage();
    vi.spyOn(performance, "mark").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => markTeleportPage(TELEPORT_MARKS.scriptStart)).not.toThrow();
  });
});
