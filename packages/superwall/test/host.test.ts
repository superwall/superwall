import { afterEach, describe, expect, it, vi } from "vitest";
import { hostOf } from "../src/host";

type Holder = typeof window & { webPaywallCtrl?: { props?: { clientSurface?: unknown } } };

const at = (search: string) => window.history.replaceState(null, "", `/${search}`);

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as Holder).webPaywallCtrl;
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
  at("");
});

describe("hostOf", () => {
  it("is the studio for the editor transport, even with a native bridge around it", () => {
    at("?transport=editor");
    vi.stubGlobal("webkit", { messageHandlers: { paywallMessageHandler: {} } });
    expect(hostOf()).toBe("studio");
  });

  it("is the iOS SDK when its message handler is there", () => {
    vi.stubGlobal("webkit", { messageHandlers: { paywallMessageHandler: {} } });
    expect(hostOf()).toBe("ios-sdk");
  });

  it("is the Android SDK by its bridge or by the platform it announces", () => {
    vi.stubGlobal("SWAndroid", {});
    expect(hostOf()).toBe("android-sdk");
    vi.unstubAllGlobals();
    at("?platform=android");
    expect(hostOf()).toBe("android-sdk");
  });

  it("is the Web SDK by the web host's surface, then by the URL the SDK stamps", () => {
    (window as Holder).webPaywallCtrl = { props: { clientSurface: "web-sdk" } };
    expect(hostOf()).toBe("web-sdk");
    delete (window as Holder).webPaywallCtrl;
    at("?client_surface=web-sdk");
    expect(hostOf()).toBe("web-sdk");
  });

  it("is the teleport page when the worker booted one, ahead of the hosted page it runs in", () => {
    (window as Holder).webPaywallCtrl = { props: { clientSurface: "web-direct" } };
    Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout" });
    expect(hostOf()).toBe("web-teleport");
  });

  it("is the hosted web paywall for its controller or its surface", () => {
    (window as Holder).webPaywallCtrl = {};
    expect(hostOf()).toBe("web-paywall");
    delete (window as Holder).webPaywallCtrl;
    at("?client_surface=web-direct");
    expect(hostOf()).toBe("web-paywall");
  });

  it("is a plain browser otherwise", () => {
    expect(hostOf()).toBe("browser");
    at("?client_surface=subdomain");
    expect(hostOf()).toBe("browser");
  });
});
