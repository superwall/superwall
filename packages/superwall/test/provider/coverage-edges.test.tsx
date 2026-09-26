import { act, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSuperwall } from "../../src/hooks";
import { useDevice } from "../../src/hooks/useDevice";
import { createHost, createWrapper, flush, renderWithProvider, testConfig } from "../helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

type OrientationStub = {
  matches: boolean;
  listeners: Set<() => void>;
};

const stubMatchMedia = (initialLandscape: boolean): OrientationStub => {
  const stub: OrientationStub = { matches: initialLandscape, listeners: new Set() };
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return stub.matches;
    },
    addEventListener: (_event: string, listener: () => void) => stub.listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => stub.listeners.delete(listener),
  }));
  return stub;
};

describe("useDevice orientation", () => {
  it("derives orientation from the viewport and tracks changes", async () => {
    const stub = stubMatchMedia(false);
    const view = renderWithProvider(() => useDevice());
    await flush();

    expect(view.result.current.orientation).toBe("portrait");

    act(() => {
      stub.matches = true;
      stub.listeners.forEach((listener) => listener());
    });
    expect(view.result.current.orientation).toBe("landscape");

    view.unmount();
    expect(stub.listeners.size).toBe(0);
  });
});

describe("createSuperwall typed bundle", () => {
  it("provides a working provider and hooks bound to the custom variables type", async () => {
    const superwall = createSuperwall<{ badge?: string }>();

    const view = renderHook(
      () => ({
        products: superwall.useProducts(),
        purchase: superwall.usePurchase(),
        actions: superwall.useActions(),
        device: superwall.useDevice(),
        user: superwall.useUser(),
        variables: superwall.useVariables(),
        introductoryOffer: superwall.useIntroductoryOffer(),
        translation: superwall.useTranslation(),
        session: superwall.useSuperwallSession(),
        snapshot: superwall.useSuperwallSnapshot(),
      }),
      {
        wrapper: ({ children }) => (
          <superwall.SuperwallProvider config={testConfig} transport={createHost().transport}>
            {children}
          </superwall.SuperwallProvider>
        ),
      },
    );
    await flush();

    expect(view.result.current.products.products.length).toBeGreaterThan(0);
    expect(view.result.current.translation.t("paywall.title")).toBe("Go Pro");
    expect(view.result.current.snapshot.status).toBe("listening");
    expect(view.result.current.session.getSnapshot().status).toBe("listening");
  });
});

describe("paywall interface exposure", () => {
  it("does not clobber globals someone else replaced before unmount", async () => {
    const view = render(<div />, { wrapper: createWrapper() });
    await flush();

    const paywallWindow = window as typeof window & {
      paywall?: unknown;
      app?: unknown;
      __sw_runtime_session?: unknown;
    };
    const foreign = { theirs: true };
    paywallWindow.paywall = foreign;
    paywallWindow.app = foreign;
    paywallWindow.__sw_runtime_session = foreign;

    view.unmount();

    expect(paywallWindow.paywall).toBe(foreign);
    expect(paywallWindow.app).toBe(foreign);
    expect(paywallWindow.__sw_runtime_session).toBe(foreign);

    delete paywallWindow.paywall;
    delete paywallWindow.app;
    delete paywallWindow.__sw_runtime_session;
  });
});

describe("host attributes on the document", () => {
  it("stamps platform, idiom and cutout from what the host reports, and clears what it doesn't", async () => {
    const view = renderWithProvider(() => null, {
      host: {
        device: { platform: "iOS", interfaceType: "iphone", deviceModel: "iPhone18,3" },
      },
    });
    await flush();
    const root = document.documentElement;
    expect(root.getAttribute("data-sw-platform")).toBe("ios");
    expect(root.getAttribute("data-sw-idiom")).toBe("phone");
    expect(root.getAttribute("data-sw-cutout")).toBe("island");
    view.unmount();

    renderWithProvider(() => null, {
      host: { device: { platform: "Android", deviceModel: "Pixel 10" } },
    });
    await flush();
    expect(root.getAttribute("data-sw-platform")).toBe("android");
    expect(root.hasAttribute("data-sw-idiom")).toBe(false);
    expect(root.hasAttribute("data-sw-cutout")).toBe(false);
  });
});

describe("web2app body on a web host", () => {
  it("marks the body web2app for a web host and clears it for a native one", async () => {
    const web = renderWithProvider(() => null, { host: { device: { platform: "web" } } });
    await flush();
    expect(document.body.classList.contains("web2app")).toBe(true);
    web.unmount();

    renderWithProvider(() => null, { host: { device: { platform: "iOS" } } });
    await flush();
    expect(document.body.classList.contains("web2app")).toBe(false);
  });
});

describe("insets on the document", () => {
  it("writes configured insets as --sw-inset-* and leaves safe-area edges to the stylesheet", async () => {
    const style = document.documentElement.style;
    const view = renderWithProvider(() => null, {
      config: { ...testConfig, insets: { top: 0, bottom: "none", right: "1rem" } },
    });
    await flush();
    expect(style.getPropertyValue("--sw-inset-top")).toBe("0px");
    expect(style.getPropertyValue("--sw-inset-bottom")).toBe("0px");
    expect(style.getPropertyValue("--sw-inset-right")).toBe("1rem");
    expect(style.getPropertyValue("--sw-inset-left")).toBe("");
    view.unmount();

    renderWithProvider(() => null, { config: testConfig });
    await flush();
    expect(style.getPropertyValue("--sw-inset-top")).toBe("");
    expect(style.getPropertyValue("--sw-inset-right")).toBe("");
  });
});

describe("background on the document", () => {
  it("paints the light color, then the dark one when the host reports dark", async () => {
    const view = renderWithProvider(() => null, {
      config: { ...testConfig, background: { light: "#ffffff", dark: "#000000" } },
      host: { device: { interfaceStyle: "Light" } },
    });
    await flush();
    expect(document.documentElement.style.backgroundColor).toBe("rgb(255, 255, 255)");
    view.unmount();

    renderWithProvider(() => null, {
      config: { ...testConfig, background: { light: "#ffffff", dark: "#000000" } },
      host: { device: { interfaceStyle: "Dark" } },
    });
    await flush();
    expect(document.documentElement.style.backgroundColor).toBe("rgb(0, 0, 0)");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("falls back to the light color for a paywall with no dark one", async () => {
    renderWithProvider(() => null, {
      config: { ...testConfig, background: "#123456" },
      host: { device: { interfaceStyle: "Dark" } },
    });
    await flush();
    expect(document.documentElement.style.backgroundColor).toBe("rgb(18, 52, 86)");
  });
});
