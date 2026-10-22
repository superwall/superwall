import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ITransport } from "@superwall/runtime";
import { SuperwallProvider } from "../../src";
import { createSuperwall, useProducts, useUser } from "../../src/hooks";
import { HOST_STATE_TIMEOUT_MS } from "../../src/provider/context";
import { createHost, createWrapper, flush, testConfig } from "../helpers";

describe("window.paywall interface", () => {
  it("exposes accept/accept64/getAllState and restores on unmount", async () => {
    const view = render(<div />, { wrapper: createWrapper() });
    await flush();

    const paywallWindow = window as typeof window & {
      paywall?: { accept: (messages: unknown[]) => void };
      app?: { getAllState: () => Record<string, unknown> };
    };

    expect(typeof paywallWindow.paywall?.accept).toBe("function");
    expect(paywallWindow.app?.getAllState()).toMatchObject({ products: expect.anything() });

    act(() => {
      paywallWindow.paywall?.accept([
        {
          event_name: "template_variables",
          variables: { products: [{ primary: { price: "$1.00" } }] },
        },
      ]);
    });
    expect(paywallWindow.app?.getAllState()).toMatchObject({
      products: { primary: { price: "$1.00" } },
    });

    view.unmount();
    expect(paywallWindow.paywall).toBeUndefined();
    expect(paywallWindow.app).toBeUndefined();
  });

  it("takes messages on window.app.accept too — the handle the web host calls", async () => {
    const view = render(<div />, { wrapper: createWrapper() });
    await flush();

    const paywallWindow = window as typeof window & {
      app?: {
        accept: (messages: unknown[]) => void;
        getAllState: () => Record<string, unknown>;
        messages?: unknown[];
      };
    };

    expect(typeof paywallWindow.app?.accept).toBe("function");
    expect(paywallWindow.app?.messages).toBeInstanceOf(Array);

    act(() => {
      paywallWindow.app?.accept([
        {
          event_name: "template_variables",
          variables: { products: [{ primary: { price: "$2.00" } }] },
        },
      ]);
    });

    expect(paywallWindow.app?.getAllState()).toMatchObject({
      products: { primary: { price: "$2.00" } },
    });

    view.unmount();
  });
});

describe("without a transport", () => {
  it("talks to the page's host and renders nothing until it answers", async () => {
    window.history.replaceState({}, "", "/?transport=editor");
    const posted: string[] = [];
    const parent = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      if (typeof message === "string") posted.push(message);
    });

    render(
      <SuperwallProvider config={testConfig}>
        <span>paywall</span>
      </SuperwallProvider>,
    );
    await flush();

    expect(screen.queryByText("paywall")).toBeNull();
    expect(posted.some((message) => message.includes('"event_name":"ping"'))).toBe(true);
    parent.mockRestore();
  });
});

const silentHost = (): ITransport => ({
  postMessage: () => undefined,
  accept: () => undefined,
  addListener: () => undefined,
  startListening: () => undefined,
});

const UserProbe = ({ seen }: { seen: unknown[] }) => {
  const user = useUser();
  seen.push(user.onboarding_goal);
  return <span>paywall</span>;
};

describe("waiting for the host", () => {
  it("first renders with the host's user already in it", async () => {
    window.history.replaceState({}, "", "/?transport=editor");
    const seen: unknown[] = [];
    const { transport } = createHost({ user: { onboarding_goal: "build" } });

    render(
      <SuperwallProvider config={testConfig} transport={transport}>
        <UserProbe seen={seen} />
      </SuperwallProvider>,
    );
    expect(screen.queryByText("paywall")).toBeNull();

    await flush();

    expect(screen.getByText("paywall")).toBeTruthy();
    expect(seen[0]).toBe("build");
  });

  it("goes ahead without a host that never answers", () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState({}, "", "/?transport=editor");
      render(
        <SuperwallProvider config={testConfig} transport={silentHost()}>
          <span>paywall</span>
        </SuperwallProvider>,
      );

      act(() => vi.advanceTimersByTime(HOST_STATE_TIMEOUT_MS - 1));
      expect(screen.queryByText("paywall")).toBeNull();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByText("paywall")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders at once on a page with no host to wait for", () => {
    render(
      <SuperwallProvider config={testConfig} transport={silentHost()}>
        <span>paywall</span>
      </SuperwallProvider>,
    );

    expect(screen.getByText("paywall")).toBeTruthy();
  });
});

describe("createSuperwall factory", () => {
  it("returns a typed, working surface", async () => {
    const sw = createSuperwall<{ badge?: string }>();

    const Paywall = () => {
      const { products } = sw.useProducts();
      return <span>{products.length} products</span>;
    };

    render(
      <sw.SuperwallProvider config={testConfig} transport={createHost().transport}>
        <Paywall />
      </sw.SuperwallProvider>,
    );
    await flush();

    await waitFor(() => expect(screen.getByText("2 products")).toBeDefined());
  });
});

describe("guard rails", () => {
  it("hooks throw outside a provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useProducts())).toThrow(
        "Superwall hooks must be used within a SuperwallProvider",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("document attributes", () => {
  it("stamps generation and scroll semantics on <html>", async () => {
    render(<div />, { wrapper: createWrapper() });
    await flush();

    expect(document.documentElement.getAttribute("data-sw-generation")).toBe("5");
    expect(document.documentElement.getAttribute("data-sw-scroll")).toBe("true");
  });

  it("tracks scrollEnabled from the config", async () => {
    render(<div />, {
      wrapper: createWrapper({ config: { ...testConfig, scrollEnabled: false } }),
    });
    await flush();

    expect(document.documentElement.getAttribute("data-sw-scroll")).toBe("false");
  });
});
