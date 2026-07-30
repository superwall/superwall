import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSuperwall, useProducts } from "../../src/hooks";
import { createWrapper, flush, renderWithProvider, testConfig } from "../helpers";

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
});

describe("mock auto mode", () => {
  it("stays out of the way when a native host is detected", async () => {
    window.history.replaceState({}, "", "/?transport=editor");

    const { result } = renderWithProvider(() => useProducts(), { mock: "auto" });
    await flush();

    expect(result.current.products).toHaveLength(2);
    expect(result.current.getProduct("primary")?.variables).toEqual({});
  });

  it("stands in for the SDK in a plain browser, without inventing a catalogue", async () => {
    const { result } = renderWithProvider(() => useProducts(), { mock: "auto" });
    await flush();

    // The references resolve so a paywall can render; the prices do not, because
    // only Superwall knows them.
    await waitFor(() => expect(result.current.getProduct("primary")).toBeDefined());
    expect(result.current.getProduct("primary")?.variables.price).toBeUndefined();
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
      <sw.SuperwallProvider config={testConfig} mock>
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
