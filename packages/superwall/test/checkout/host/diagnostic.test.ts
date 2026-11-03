import { afterEach, describe, expect, it, vi } from "vitest";
import { hostEvents } from "../../../src/checkout/host";
import { browserOf, currentBrowser, isInAppBrowser } from "../../../src/browser";

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_7_1 like Mac OS X) AppleWebKit/605.1.15";

const context = { checkoutContextId: "ctx_1", productIdentifier: "live:price_1:intro" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ANDROID = "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko)";

describe("browserOf", () => {
  it("names the app whose in-app browser opened the page", () => {
    expect(browserOf(`${IOS} (KHTML, like Gecko) Mobile/15E148 Instagram 450.0.0.25.110`)).toBe(
      "instagram",
    );
    expect(browserOf(`${IOS} Mobile/15E148 [FBAN/FBIOS;FBAV/530.0.0.41.104;]`)).toBe("facebook");
    expect(browserOf(`${IOS} Mobile/15E148 musical_ly_43.5.0 JsSdk/2.0`)).toBe("tiktok");
    expect(browserOf(`${IOS} Mobile/15E148 Snapchat/13.60.0.48`)).toBe("snapchat");
    expect(browserOf(`${IOS} Mobile/15E148 [Pinterest/iOS]`)).toBe("pinterest");
    expect(browserOf(`${IOS} Mobile/15E148 [LinkedInApp]/9.31.6`)).toBe("linkedin");
    expect(browserOf(`${IOS} Mobile/15E148 Twitter for iPhone/10.70`)).toBe("twitter");
    expect(browserOf(`${IOS} Mobile/15E148 MicroMessenger/8.0.50`)).toBe("wechat");
    expect(browserOf(`${IOS} Mobile/15E148 Safari Line/14.10.0`)).toBe("line");
    expect(browserOf(`${ANDROID} Chrome/131.0 Mobile Safari/537.36 Instagram 450.0`)).toBe(
      "instagram",
    );
  });

  it("names a regular browser, and says it is not in an app", () => {
    expect(browserOf(`${IOS} (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1`)).toBe(
      "safari",
    );
    expect(browserOf(`${IOS} (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1`)).toBe(
      "chrome",
    );
    expect(browserOf(`${IOS} (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15`)).toBe(
      "firefox",
    );
    expect(browserOf(`${IOS} (KHTML, like Gecko) EdgiOS/131.0 Mobile/15E148 Safari/605.1.15`)).toBe(
      "edge",
    );
    expect(browserOf(`${ANDROID} Chrome/131.0.0.0 Mobile Safari/537.36`)).toBe("chrome");
    expect(browserOf(`${ANDROID} SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36`)).toBe(
      "samsung",
    );
    expect(browserOf(`${ANDROID} Chrome/131.0 Mobile Safari/537.36 OPR/86.0`)).toBe("opera");
    expect(browserOf(`${ANDROID} Chrome/131.0 Mobile Safari/537.36 EdgA/131.0`)).toBe("edge");
    expect(
      browserOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0"),
    ).toBe("firefox");
  });

  it("names nothing inside an app's own web view or for an unknown agent", () => {
    expect(browserOf(`${IOS} (KHTML, like Gecko) Mobile/15E148`)).toBeUndefined();
    expect(browserOf("")).toBeUndefined();
    expect(
      browserOf(
        "Mozilla/5.0 (Linux; Android 15; SM-S928B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36",
      ),
    ).toBeUndefined();
    expect(
      browserOf(
        "Mozilla/5.0 (Linux; Android 15; SM-S928B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 450.0",
      ),
    ).toBe("instagram");
  });

  it("reads the page's own user agent, and names nothing without a navigator", () => {
    vi.stubGlobal("navigator", { userAgent: `${IOS} Instagram 450.0.0` });
    expect(currentBrowser()).toBe("instagram");
    vi.stubGlobal("navigator", undefined);
    expect(currentBrowser()).toBeUndefined();
  });

  it("tells an app's in-app browser from a regular one", () => {
    expect(isInAppBrowser("instagram")).toBe(true);
    expect(isInAppBrowser("line")).toBe(true);
    expect(isInAppBrowser("safari")).toBe(false);
    expect(isInAppBrowser(undefined)).toBe(false);
  });
});

describe("the Stripe checkout diagnostic", () => {
  it("goes to a web host, with the context, rounded ms and the in-app browser", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
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
        browser: "instagram",
        in_app_browser: true,
      },
      {
        event_name: "stripe_checkout_diagnostic",
        checkout_context_id: "ctx_1",
        product_identifier: "live:price_1:intro",
        stage: "stripe_error",
        ms: -20,
        browser: "instagram",
        in_app_browser: true,
        error: "IntegrationError: nope",
      },
    ]);
  });

  it("names the regular browser on the wire, and unknown when it cannot tell", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("navigator", { userAgent: `${IOS} Version/26.0 Mobile/15E148 Safari/604.1` });
    const post = vi.fn();
    hostEvents(post).diagnostic(context, "tap", 0);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ browser: "safari", in_app_browser: false }),
    );
    vi.stubGlobal("navigator", { userAgent: `${IOS} Mobile/15E148` });
    hostEvents(post).diagnostic(context, "tap", 0);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ browser: "unknown", in_app_browser: false }),
    );
  });

  it("stays off the native SDKs, which cannot decode it, but still logs it in the page", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("webkit", { messageHandlers: { paywallMessageHandler: {} } });
    const post = vi.fn();
    hostEvents(post).diagnostic(context, "ready_timeout", 10_000.4);
    expect(post).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "[superwall] checkout ready_timeout +10000ms",
      expect.objectContaining({
        stage: "ready_timeout",
        checkout_context_id: "ctx_1",
        host: "ios-sdk",
      }),
    );
  });

  it("logs every stage in the page on a web host too", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    hostEvents(vi.fn()).diagnostic(context, "stripe_error", 812, "IntegrationError: nope");
    expect(info).toHaveBeenCalledWith(
      "[superwall] checkout stripe_error +812ms",
      expect.objectContaining({ error: "IntegrationError: nope", host: "browser" }),
    );
  });
});
