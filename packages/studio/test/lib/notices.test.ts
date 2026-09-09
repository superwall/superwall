import { describe, expect, it } from "vitest";
import { noticeFor } from "../../src/lib/notices";

describe("noticeFor", () => {
  it("names the action the paywall asked for, and how it reads", () => {
    expect(noticeFor({ event_name: "close" })).toEqual({
      action: "close",
      subject: undefined,
      tone: "warning",
    });
    expect(noticeFor({ event_name: "open_url_external", url: "https://x" })?.tone).toBe("info");
    expect(
      noticeFor({
        event_name: "post_checkout_complete",
        checkout_context_id: "ctx_1",
        product_identifier: "test:price_123:no-trial",
      })?.tone,
    ).toBe("success");
  });

  it("stays quiet for anything that changes nothing a device would do", () => {
    expect(
      noticeFor({
        event_name: "page_view",
        type: "entry",
        page_node_id: "n1",
        flow_position: 0,
        page_name: "index",
        navigation_node_id: "nav",
      }),
    ).toBeUndefined();
    expect(noticeFor({ event_name: "haptic_feedback", haptic_type: "light" })).toBeUndefined();
    expect(noticeFor({ event_name: "has_set_dom", data: {} })).toBeUndefined();
    expect(noticeFor({ event_name: "var_click", var_name: "price" })).toBeUndefined();
  });

  it("stays quiet for the purchase and restore requests — the prompt already covers them", () => {
    expect(noticeFor({ event_name: "purchase", product: "primary" })).toBeUndefined();
    expect(noticeFor({ event_name: "restore" })).toBeUndefined();
  });

  it("carries the subject worth naming, taking the first field that has one", () => {
    expect(noticeFor({ event_name: "open_url", url: "https://superwall.com" })?.subject).toBe(
      "https://superwall.com",
    );
    expect(noticeFor({ event_name: "custom_placement", name: "done", params: {} })?.subject).toBe(
      "done",
    );
    expect(
      noticeFor({
        event_name: "request_permission",
        permission_type: "notification",
        request_id: "r1",
      })?.subject,
    ).toBe("notification");
    expect(noticeFor({ event_name: "open_deep_link", link: "app://x" })?.subject).toBe("app://x");
  });

  it("has no subject rather than an empty one", () => {
    expect(noticeFor({ event_name: "open_url", url: "" })?.subject).toBeUndefined();
    expect(
      noticeFor({
        event_name: "request_callback",
        name: "",
        request_id: "r1",
        behavior: "blocking",
      })?.subject,
    ).toBeUndefined();
  });

  it("reports an event it has no opinion about as plain information", () => {
    expect(noticeFor({ event_name: "request_store_review", review_type: "in-app" })).toEqual({
      action: "request_store_review",
      subject: undefined,
      tone: "info",
    });
  });
});
