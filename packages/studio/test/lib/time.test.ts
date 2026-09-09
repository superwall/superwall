import { describe, expect, it } from "vitest";
import { timeAgo } from "../../src/lib/time";

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

  it("rejects garbage", () => {
    expect(timeAgo("not-a-date")).toBeUndefined();
  });
});
