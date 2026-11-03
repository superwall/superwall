import { afterEach, describe, expect, it, vi } from "vitest";
import { hostEvents } from "../../../src/checkout/host";
import { inAppBrowser, inAppBrowserOf } from "../../../src/checkout/host/browser";

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_7_1 like Mac OS X) AppleWebKit/605.1.15";

const context = { checkoutContextId: "ctx_1", productIdentifier: "live:price_1:intro" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inAppBrowserOf", () => {
  it("names the app whose in-app browser opened the page", () => {
    expect(
      inAppBrowserOf(`${IOS} (KHTML, like Gecko) Mobile/15E148 Instagram 450.0.0.25.110`),
    ).toBe("instagram");
    expect(inAppBrowserOf(`${IOS} Mobile/15E148 [FBAN/FBIOS;FBAV/530.0.0.41.104;]`)).toBe(
      "facebook",
    );
    expect(inAppBrowserOf(`${IOS} Mobile/15E148 musical_ly_43.5.0 JsSdk/2.0`)).toBe("tiktok");
    expect(inAppBrowserOf(`${IOS} Mobile/15E148 Snapchat/13.60.0.48`)).toBe("snapchat");
    expect(inAppBrowserOf(`${IOS} Mobile/15E148 [Pinterest/iOS]`)).toBe("pinterest");
    expect(inAppBrowserOf(`${IOS} Mobile/15E148 [LinkedInApp]/9.31.6`)).toBe("linkedin");
    expect(inAppBrowserOf(`${IOS} Mobile/15E148 Twitter for iPhone/10.70`)).toBe("twitter");
    expect(inAppBrowserOf(`${IOS} Mobile/15E148 MicroMessenger/8.0.50`)).toBe("wechat");
    expect(inAppBrowserOf(`${IOS} Mobile/15E148 Safari Line/14.10.0`)).toBe("line");
  });

  it("is none in a plain browser", () => {
    expect(
      inAppBrowserOf(`${IOS} (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1`),
    ).toBe("none");
    expect(inAppBrowserOf("")).toBe("none");
  });

  it("reads the page's own user agent, and answers none without a navigator", () => {
    vi.stubGlobal("navigator", { userAgent: `${IOS} Instagram 450.0.0` });
    expect(inAppBrowser()).toBe("instagram");
    vi.stubGlobal("navigator", undefined);
    expect(inAppBrowser()).toBe("none");
  });
});

describe("the Stripe checkout diagnostic", () => {
  it("goes to a web host, with the context, rounded ms and the in-app browser", () => {
    vi.stubGlobal("navigator", { userAgent: `${IOS} Instagram 450.0.0` });
    const post = vi.fn();
    const events = hostEvents(post);

    events.diagnostic(context, "session_ready", 1_234.6);
    events.diagnostic(context, "stripe_error", -20, "IntegrationError: nope");

    expect(post.mock.calls.map(([message]) => message)).toEqual([
      {
        event_name: "stripe_checkout_diagnostic",
        checkout_context_id: "ctx_1",
        product_identifier: "live:price_1:intro",
        stage: "session_ready",
        ms: 1_235,
        in_app_browser: "instagram",
      },
      {
        event_name: "stripe_checkout_diagnostic",
        checkout_context_id: "ctx_1",
        product_identifier: "live:price_1:intro",
        stage: "stripe_error",
        ms: -20,
        in_app_browser: "instagram",
        error: "IntegrationError: nope",
      },
    ]);
  });

  it("stays off the native SDKs, which cannot decode it", () => {
    vi.stubGlobal("webkit", { messageHandlers: { paywallMessageHandler: {} } });
    const post = vi.fn();
    hostEvents(post).diagnostic(context, "tap", 0);
    expect(post).not.toHaveBeenCalled();
  });
});
