import { describe, expect, it } from "vitest";
import { noticeFor } from "../src/lib/events";

describe("noticeFor", () => {
  it("names the action the paywall asked for, and how it reads", () => {
    expect(noticeFor({ event_name: "close" })).toEqual({
      action: "close",
      subject: undefined,
      tone: "warning",
    });
    expect(noticeFor({ event_name: "open_url_external", url: "https://x" })?.tone).toBe("info");
    expect(noticeFor({ event_name: "transaction_complete" })?.tone).toBe("success");
  });

  it("stays quiet for anything that changes nothing a device would do", () => {
    for (const event_name of ["page_view", "haptic_feedback", "ping", "var_click", "page_styles"]) {
      expect(noticeFor({ event_name })).toBeUndefined();
    }
  });

  it("stays quiet for the purchase and restore requests — the prompt already covers them", () => {
    expect(noticeFor({ event_name: "purchase" })).toBeUndefined();
    expect(noticeFor({ event_name: "restore" })).toBeUndefined();
  });

  it("carries the subject worth naming, taking the first field that has one", () => {
    expect(noticeFor({ event_name: "open_url", url: "https://superwall.com" })?.subject).toBe(
      "https://superwall.com",
    );
    expect(noticeFor({ event_name: "custom_placement", placementName: "done" })?.subject).toBe(
      "done",
    );
    expect(
      noticeFor({ event_name: "request_permission", permission_type: "notification" })?.subject,
    ).toBe("notification");
    expect(noticeFor({ event_name: "open_deep_link", link: "app://x" })?.subject).toBe("app://x");
  });

  it("has no subject rather than an empty one", () => {
    expect(noticeFor({ event_name: "open_url", url: "" })?.subject).toBeUndefined();
    expect(noticeFor({ event_name: "custom_placement" })?.subject).toBeUndefined();
    expect(noticeFor({ event_name: "open_url", url: 42 })?.subject).toBeUndefined();
  });

  it("still reports an event it has never seen, rather than swallowing it", () => {
    expect(noticeFor({ event_name: "some_future_event" })).toEqual({
      action: "some_future_event",
      subject: undefined,
      tone: "info",
    });
  });
});
