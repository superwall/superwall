import { describe, expect, it } from "vitest";
import { timeAgo, timeUntil } from "../../src/lib/time";

describe("timeAgo", () => {
  const now = Date.parse("2026-07-27T12:00:00Z");

  it("formats across unit boundaries", () => {
    expect(timeAgo("2026-07-27T11:59:30Z", now)).toBe("30 seconds ago");
    expect(timeAgo("2026-07-27T11:15:00Z", now)).toBe("45 minutes ago");
    expect(timeAgo("2026-07-27T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-07-25T12:00:00Z", now)).toBe("2 days ago");
    expect(timeAgo("2026-06-20T12:00:00Z", now)).toContain("month");
    expect(timeAgo("2024-07-27T12:00:00Z", now)).toBe("2 years ago");
  });

  it("says now for a moment in the future", () => {
    expect(timeAgo("2026-07-27T12:00:05Z", now)).toBe("now");
  });

  it("rejects garbage", () => {
    expect(timeAgo("not-a-date")).toBeUndefined();
  });
});

describe("timeUntil", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it("says how far ahead a delay lands", () => {
    expect(timeUntil(45 * 1000)).toBe("in 45 seconds");
    expect(timeUntil(3 * HOUR)).toBe("in 3 hours");
    expect(timeUntil(DAY)).toBe("tomorrow");
    expect(timeUntil(6 * DAY)).toBe("in 6 days");
    expect(timeUntil(14 * DAY)).toBe("in 2 weeks");
  });

  it("treats a delay already due as now", () => {
    expect(timeUntil(0)).toBe("now");
    expect(timeUntil(-DAY)).toBe("now");
  });
});
