import { act, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSuperwall } from "../../src";
import { useDevice } from "../../src/hooks/useDevice";
import { createWrapper, flush, renderWithProvider, testConfig } from "../helpers";

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
        trial: superwall.useTrialEligibility(),
        translation: superwall.useTranslation(),
        session: superwall.useSuperwallSession(),
        snapshot: superwall.useSuperwallSnapshot(),
      }),
      {
        wrapper: ({ children }) => (
          <superwall.SuperwallProvider config={testConfig} mock>
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
