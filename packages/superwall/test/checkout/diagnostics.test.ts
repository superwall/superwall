import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutDiagnostics,
  DIAGNOSTIC_WINDOW,
  type DiagnosticReport,
} from "../../src/checkout/diagnostics";

let clock = 0;
const now = () => clock;

const reporter = () => {
  const report = vi.fn<DiagnosticReport>();
  const stages = () => report.mock.calls.map(([stage, ms, error]) => ({ stage, ms, error }));
  return { report, stages };
};

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkout diagnostics after a tap", () => {
  it("reports the tap, the session wait, and each Stripe stage with ms since the tap", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    const { report, stages } = reporter();
    const tappedAt = clock;
    clock += 1_300;

    diagnostics.track("cs_a", tappedAt, report);
    clock += 400;
    diagnostics.record("cs_a", "stripe_js_loaded");
    clock += 600;
    diagnostics.record("cs_a", "embedded_mounted");
    clock += 900;
    diagnostics.record("cs_a", "checkout_rendered");

    expect(stages()).toEqual([
      { stage: "tap", ms: 0, error: undefined },
      { stage: "session_ready", ms: 1_300, error: undefined },
      { stage: "stripe_js_loaded", ms: 1_700, error: undefined },
      { stage: "embedded_mounted", ms: 2_300, error: undefined },
      { stage: "checkout_rendered", ms: 3_200, error: undefined },
    ]);
  });

  it("replays what a warm checkout did before the tap, with negative ms, and then stops", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    diagnostics.record("cs_a", "stripe_js_loaded");
    clock += 500;
    diagnostics.record("cs_a", "embedded_mounted");
    clock += 500;
    diagnostics.record("cs_a", "checkout_rendered");
    clock += 4_000;

    const { report, stages } = reporter();
    diagnostics.track("cs_a", clock, report);
    diagnostics.record("cs_a", "checkout_rendered");

    expect(stages().map(({ stage, ms }) => [stage, ms])).toEqual([
      ["tap", 0],
      ["session_ready", 0],
      ["stripe_js_loaded", -5_000],
      ["embedded_mounted", -4_500],
      ["checkout_rendered", -4_000],
    ]);
  });

  it("replays nothing past a checkout that already rendered", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    diagnostics.record("cs_a", "checkout_rendered");
    diagnostics.record("cs_a", "stripe_error", new Error("late"));

    const { report, stages } = reporter();
    diagnostics.track("cs_a", clock, report);

    expect(stages().map(({ stage }) => stage)).toEqual([
      "tap",
      "session_ready",
      "checkout_rendered",
    ]);
  });

  it("keeps reporting past the ready timeout, so a late Stripe still shows up", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    const { report, stages } = reporter();
    const tracker = diagnostics.track("cs_a", clock, report);

    clock += 10_000;
    tracker.timedOut();
    clock += 2_500;
    diagnostics.record("cs_a", "checkout_rendered");
    tracker.timedOut();

    expect(stages().map(({ stage, ms }) => [stage, ms])).toEqual([
      ["tap", 0],
      ["session_ready", 0],
      ["ready_timeout", 10_000],
      ["checkout_rendered", 12_500],
    ]);
  });

  it("carries Stripe's error, named, and keeps watching for a retry", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    const { report, stages } = reporter();
    diagnostics.track("cs_a", clock, report);

    const integration = new Error("You cannot have multiple Embedded Checkout objects.");
    integration.name = "IntegrationError";
    diagnostics.record("cs_a", "stripe_error", integration);
    diagnostics.record("cs_a", "stripe_error", "offline");
    diagnostics.record("cs_a", "stripe_error", { code: 1 });
    diagnostics.record("cs_a", "stripe_error", new Error("x".repeat(900)));
    diagnostics.record("cs_a", "checkout_rendered");

    const errors = stages().filter(({ stage }) => stage === "stripe_error");
    expect(errors.map(({ error }) => error?.slice(0, 60))).toEqual([
      "IntegrationError: You cannot have multiple Embedded Checkout",
      "offline",
      "[object Object]",
      `Error: ${"x".repeat(53)}`,
    ]);
    expect(errors[3]?.error).toHaveLength(500);
    expect(stages().at(-1)?.stage).toBe("checkout_rendered");
  });

  it("ignores another session's stages and anything after it stopped", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    const { report, stages } = reporter();
    const tracker = diagnostics.track("cs_a", clock, report);

    diagnostics.record("cs_b", "checkout_rendered");
    tracker.stop();
    tracker.stop();
    diagnostics.record("cs_a", "checkout_rendered");
    tracker.timedOut();

    expect(stages().map(({ stage }) => stage)).toEqual(["tap", "session_ready"]);
  });

  it("stops listening once the diagnostic window is over", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    const { report, stages } = reporter();
    diagnostics.track("cs_a", clock, report);

    vi.advanceTimersByTime(DIAGNOSTIC_WINDOW);
    diagnostics.record("cs_a", "checkout_rendered");

    expect(stages().map(({ stage }) => stage)).toEqual(["tap", "session_ready"]);
  });

  it("hands a session to the newest tap, so a re-tap never reports twice", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    const first = reporter();
    const second = reporter();
    diagnostics.track("cs_a", clock, first.report);
    clock += 10_000;
    diagnostics.track("cs_a", clock, second.report);
    clock += 1_000;
    diagnostics.record("cs_a", "checkout_rendered");

    expect(first.stages().map(({ stage }) => stage)).toEqual(["tap", "session_ready"]);
    expect(second.stages().map(({ stage, ms }) => [stage, ms])).toEqual([
      ["tap", 0],
      ["session_ready", 0],
      ["checkout_rendered", 1_000],
    ]);
  });

  it("forgets the oldest sessions, and the oldest stages of a busy one", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    for (let index = 0; index < 21; index++) {
      diagnostics.record(`cs_${index}`, "stripe_js_loaded");
    }
    for (let index = 0; index < 25; index++) {
      clock += 1;
      diagnostics.record("cs_busy", "stripe_error", `attempt ${index}`);
    }

    const forgotten = reporter();
    diagnostics.track("cs_0", clock, forgotten.report);
    const kept = reporter();
    diagnostics.track("cs_20", clock, kept.report);
    const busy = reporter();
    diagnostics.track("cs_busy", clock, busy.report);

    expect(forgotten.stages().map(({ stage }) => stage)).toEqual(["tap", "session_ready"]);
    expect(kept.stages().map(({ stage }) => stage)).toContain("stripe_js_loaded");
    const attempts = busy.stages().filter(({ stage }) => stage === "stripe_error");
    expect(attempts).toHaveLength(20);
    expect(attempts[0]?.error).toBe("attempt 5");
  });

  it("reads the real clock by default", () => {
    vi.setSystemTime(50_000);
    const diagnostics = createCheckoutDiagnostics();
    const { report, stages } = reporter();
    diagnostics.track("cs_a", 48_000, report);
    expect(stages()[1]).toEqual({ stage: "session_ready", ms: 2_000, error: undefined });
  });

  it("never lets a failing report reach the checkout", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const diagnostics = createCheckoutDiagnostics(now);
    const report = vi.fn<DiagnosticReport>(() => {
      throw new Error("host gone");
    });
    const tracker = diagnostics.track("cs_a", clock, report);

    expect(() => diagnostics.record("cs_a", "stripe_js_loaded")).not.toThrow();
    expect(() => tracker.timedOut()).not.toThrow();
    expect(() => diagnostics.record("cs_a", "checkout_rendered")).not.toThrow();
    expect(report.mock.calls.map(([stage]) => stage)).toEqual([
      "tap",
      "session_ready",
      "stripe_js_loaded",
      "ready_timeout",
      "checkout_rendered",
    ]);
    errors.mockRestore();
  });

  it("reports to every tap even when one of them throws", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const diagnostics = createCheckoutDiagnostics(now);
    diagnostics.track("cs_a", clock, () => {
      throw new Error("host gone");
    });
    const { report, stages } = reporter();
    diagnostics.track("cs_b", clock, report);

    diagnostics.record("cs_a", "stripe_js_loaded");
    diagnostics.record("cs_b", "stripe_js_loaded");

    expect(stages().map(({ stage }) => stage)).toEqual([
      "tap",
      "session_ready",
      "stripe_js_loaded",
    ]);
    errors.mockRestore();
  });

  it("names an error it cannot turn into text", () => {
    const diagnostics = createCheckoutDiagnostics(now);
    const { report, stages } = reporter();
    diagnostics.track("cs_a", clock, report);
    const unreadable = {
      toString: () => {
        throw new Error("no");
      },
    };

    diagnostics.record("cs_a", "stripe_error", unreadable);

    expect(stages()[2]).toEqual({ stage: "stripe_error", ms: 0, error: "Unreadable error" });
  });
});
