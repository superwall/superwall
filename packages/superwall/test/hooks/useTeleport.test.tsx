import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallConfig } from "@superwall/runtime";
import { pageNavigation } from "../../src/checkout/teleport/page";
import { useActions, useTeleport } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

const config: SuperwallConfig = { teleport: { route: "checkout" } };

const device = { platform: "iOS", publicApiKey: "pk_test", sdkVersionPadded: "004.018.000" };

const bootWebHalf = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
  Reflect.set(window, "__SW_TELEPORT__", {
    id: "v1:tp",
    route: "checkout",
    returnUrl: "myapp://superwall/return",
  });
};

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setVisibility("visible");
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
  document.querySelectorAll(".sw-teleport-dim").forEach((node) => node.remove());
});

describe("useTeleport on the web half", () => {
  it("is returning while iOS asks, and resolves how the return went", async () => {
    bootWebHalf();
    const { result } = renderWithProvider(() => useTeleport(), { config, host: { device } });
    await flush();
    expect(result.current.returning).toBe(false);

    let returned: Promise<string> | undefined;
    act(() => {
      returned = result.current.returnToApp();
    });
    expect(result.current.returning).toBe(true);
    expect(pageNavigation.assign).toHaveBeenCalledWith("myapp://superwall/return?reason=closed");

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      setVisibility("hidden");
      await returned;
    });
    await expect(returned).resolves.toBe("opened");
    expect(result.current.returning).toBe(false);
  });

  it("resolves close() with the return's result instead of closing", async () => {
    bootWebHalf();
    const { result } = renderWithProvider(() => useActions(), { config, host: { device } });
    await flush();

    let closed: Promise<string> | undefined;
    act(() => {
      closed = result.current.close();
    });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await closed;
    });
    await expect(closed).resolves.toBe("opened");
  });
});

describe("useTeleport in the app", () => {
  it("is never returning, and resolves opened at once", async () => {
    const { result } = renderWithProvider(() => useTeleport(), { config, host: { device } });
    await flush();
    expect(result.current.returning).toBe(false);
    await expect(result.current.returnToApp()).resolves.toBe("opened");
    expect(result.current.returning).toBe(false);
  });

  it("closes the paywall with close(), which returns nothing", async () => {
    const { result } = renderWithProvider(() => useActions(), { config, host: { device } });
    await flush();
    expect(result.current.close()).toBeUndefined();
  });
});
