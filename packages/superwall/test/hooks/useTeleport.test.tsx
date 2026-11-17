import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallConfig } from "@superwall/runtime";
import { pageNavigation } from "../../src/checkout/teleport/page";
import { applePayFor } from "../../src/checkout/flow";
import { teleportFor } from "../../src/checkout/teleport/flow";
import { useActions, usePurchase, useSuperwallSession, useTeleport } from "../../src/hooks";
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
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
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

  it("returns with reason=failed when the shopper's payment failed, from onFailure", async () => {
    bootWebHalf();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const returns: Promise<string>[] = [];
    const { result } = renderWithProvider(
      () => {
        const teleport = useTeleport();
        return {
          session: useSuperwallSession(),
          purchase: usePurchase({ onFailure: () => returns.push(teleport.returnToApp()) }),
        };
      },
      {
        config: { ...config, checkout: "applePay" },
        host: {
          device: { ...device, platform: "web" },
          products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
        },
      },
    );
    await flush();
    vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue({
      status: "failed",
      failure: { reason: "insufficient_funds", store: "stripe", declineCode: "insufficient_funds" },
    });

    await act(async () => {
      await result.current.purchase.purchase("primary");
    });

    expect(returns).toHaveLength(1);
    expect(pageNavigation.assign).toHaveBeenCalledWith("myapp://superwall/return?reason=failed");
  });

  it("leaves the app the failure and data, without waiting on it, beside the flow", async () => {
    bootWebHalf();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const failure = {
      reason: "insufficient_funds" as const,
      store: "stripe" as const,
      declineCode: "insufficient_funds",
    };
    const { result } = renderWithProvider(
      () => ({ session: useSuperwallSession(), teleport: useTeleport(), purchase: usePurchase() }),
      {
        config: { ...config, checkout: "applePay" },
        host: {
          device: { ...device, platform: "web" },
          products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
        },
      },
    );
    await flush();
    vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue({
      status: "failed",
      failure,
    });
    await act(async () => {
      await result.current.purchase.purchase("primary");
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    let save: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (save = resolve)));

    act(() => {
      void result.current.teleport.returnToApp({ data: { offer: "apple_pay" } });
    });

    expect(pageNavigation.assign).toHaveBeenCalledWith("myapp://superwall/return?reason=failed");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/checkout\/teleport\/session$/);
    expect(init?.keepalive).toBe(true);
    expect(JSON.parse(String(init?.body))).toEqual({
      teleportId: "v1:tp",
      session: {
        query: {},
        returned: { failure, data: { offer: "apple_pay" }, at: expect.any(Number) },
      },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await act(async () => {
      save(new Response(JSON.stringify({ saved: false })));
      await Promise.resolve();
    });
    await flush();
    expect(warn).toHaveBeenCalledWith(
      "The teleport is closed, so the app won't receive what the page left it.",
    );
  });

  it("drops data over 16 KB but still leaves the failure for the app", async () => {
    bootWebHalf();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = {
      reason: "insufficient_funds" as const,
      store: "stripe" as const,
      code: "card_declined",
      declineCode: "insufficient_funds",
    };
    const { result } = renderWithProvider(
      () => ({ session: useSuperwallSession(), teleport: useTeleport(), purchase: usePurchase() }),
      {
        config: { ...config, checkout: "applePay" },
        host: {
          device: { ...device, platform: "web" },
          products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
        },
      },
    );
    await flush();
    vi.spyOn(applePayFor(result.current.session), "purchase").mockResolvedValue({
      status: "failed",
      failure,
    });
    await act(async () => {
      await result.current.purchase.purchase("primary");
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ saved: true })));

    act(() => {
      void result.current.teleport.returnToApp({ data: { blob: "x".repeat(17 * 1024) } });
    });

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/over the 16384-byte limit/));
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      teleportId: "v1:tp",
      session: { query: {}, returned: { failure, at: expect.any(Number) } },
    });
  });

  it("logs a save the backend refuses with an error, apart from a closed teleport", async () => {
    bootWebHalf();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderWithProvider(() => useTeleport(), { config, host: { device } });
    await flush();
    vi.mocked(fetch).mockResolvedValue(new Response("boom", { status: 500 }));

    await act(async () => {
      void result.current.returnToApp({ data: { offer: "apple_pay" } });
      await Promise.resolve();
    });
    await flush();

    expect(warn).toHaveBeenCalledWith(
      "Leaving the failure and data for the app failed:",
      expect.objectContaining({ message: "Saving the teleport return failed: 500 boom" }),
    );
  });

  it("leaves nothing when there is no failure and no data, and refuses data over 16 KB", async () => {
    bootWebHalf();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderWithProvider(() => useTeleport(), { config, host: { device } });
    await flush();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    act(() => {
      void result.current.returnToApp();
    });
    act(() => {
      void result.current.returnToApp({ data: { blob: "x".repeat(17 * 1024) } });
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/over the 16384-byte limit/));
    expect(pageNavigation.assign).toHaveBeenCalledTimes(2);
  });

  it("logs a save that fails, and still returns", async () => {
    bootWebHalf();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderWithProvider(() => useTeleport(), { config, host: { device } });
    await flush();
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    await act(async () => {
      void result.current.returnToApp({ data: { offer: "apple_pay" } });
      await Promise.resolve();
    });
    await flush();

    expect(pageNavigation.assign).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Leaving the failure and data for the app failed:",
      expect.any(Error),
    );
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

  it("shows why the page's payment failed while waiting", async () => {
    const { result, rerender } = renderWithProvider(
      () => ({ session: useSuperwallSession(), teleport: useTeleport() }),
      { config, host: { device } },
    );
    await flush();
    const failure = { reason: "card_declined" as const, store: "stripe" as const };
    vi.spyOn(teleportFor(result.current.session), "getStatus").mockReturnValue({
      status: "waiting",
      returned: false,
      failure,
    });
    rerender();
    expect(result.current.teleport).toMatchObject({ status: "waiting", failure });
  });

  it("shows the data the page left and calls onReturnData once the shopper is back", async () => {
    vi.useFakeTimers();
    try {
      const replies: Record<string, unknown> = {
        "checkout/teleport": {
          teleportId: "v1:tp",
          url: "https://acme.superwall.app/sw-teleport/v1:tp",
        },
        "checkout/teleport/status": { status: "claimed", checkoutContextId: "ctx_1" },
        "checkout/status": { status: "pending" },
        "checkout/teleport/session": { saved: true },
        "checkout/teleport/session/read": {
          session: {
            query: {},
            returned: { data: { offer: "apple_pay" }, at: Number.MAX_SAFE_INTEGER },
          },
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = new URL(url).pathname.replace(/^.*\/public\/v1\//, "");
          return new Response(JSON.stringify(replies[path] ?? {}));
        }),
      );
      Reflect.set(window, "app", {});
      const onReturnData = vi.fn();
      const { result } = renderWithProvider(
        () => ({ session: useSuperwallSession(), teleport: useTeleport({ onReturnData }) }),
        { config, host: { device } },
      );
      await flush();
      const teleporter = teleportFor(result.current.session);
      if (teleporter.kind !== "app") throw new Error("expected the app half");
      await act(async () => {
        void teleporter.begin({ productReference: "card", query: {} });
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await act(async () => {
        void teleporter.handleReturn("closed");
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(result.current.teleport).toMatchObject({
        status: "waiting",
        returned: true,
        data: { offer: "apple_pay" },
      });
      expect(onReturnData).toHaveBeenCalledExactlyOnceWith({ offer: "apple_pay" });
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(window, "app");
    }
  });

  it("keeps waiting while what the page left cannot be read, and shows it once it can", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      let readable = false;
      const replies: Record<string, unknown> = {
        "checkout/teleport": {
          teleportId: "v1:tp",
          url: "https://acme.superwall.app/sw-teleport/v1:tp",
        },
        "checkout/teleport/status": { status: "claimed", checkoutContextId: "ctx_1" },
        "checkout/status": { status: "pending" },
        "checkout/teleport/session": { saved: true },
        "checkout/teleport/session/read": {
          session: {
            query: {},
            returned: { data: { offer: "apple_pay" }, at: Number.MAX_SAFE_INTEGER },
          },
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = new URL(url).pathname.replace(/^.*\/public\/v1\//, "");
          if (path === "checkout/teleport/session/read" && !readable) {
            throw new Error("offline");
          }
          return new Response(JSON.stringify(replies[path] ?? {}));
        }),
      );
      Reflect.set(window, "app", {});
      const onReturnData = vi.fn();
      const { result } = renderWithProvider(
        () => ({ session: useSuperwallSession(), teleport: useTeleport({ onReturnData }) }),
        { config, host: { device } },
      );
      await flush();
      const teleporter = teleportFor(result.current.session);
      if (teleporter.kind !== "app") throw new Error("expected the app half");
      await act(async () => {
        void teleporter.begin({ productReference: "card", query: {} });
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await act(async () => {
        void teleporter.handleReturn("closed");
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(result.current.teleport).toMatchObject({ status: "waiting", returned: true });
      readable = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(onReturnData).toHaveBeenCalledExactlyOnceWith({ offer: "apple_pay" });
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(window, "app");
    }
  });

  it("gives up on a stalled read of what the page left and still sees the payment complete", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      let paid = false;
      const replies: Record<string, unknown> = {
        "checkout/teleport": {
          teleportId: "v1:tp",
          url: "https://acme.superwall.app/sw-teleport/v1:tp",
        },
        "checkout/teleport/status": { status: "claimed", checkoutContextId: "ctx_1" },
        "checkout/teleport/session": { saved: true },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit = {}) => {
          const path = new URL(url).pathname.replace(/^.*\/public\/v1\//, "");
          if (path === "checkout/teleport/session/read") {
            return new Promise<Response>((_, reject) => {
              init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            });
          }
          if (path === "checkout/status") {
            return new Response(JSON.stringify({ status: paid ? "completed" : "pending" }));
          }
          return new Response(JSON.stringify(replies[path] ?? {}));
        }),
      );
      Reflect.set(window, "app", {});
      const { result } = renderWithProvider(
        () => ({ session: useSuperwallSession(), teleport: useTeleport() }),
        { config, host: { device } },
      );
      await flush();
      const teleporter = teleportFor(result.current.session);
      if (teleporter.kind !== "app") throw new Error("expected the app half");
      await act(async () => {
        void teleporter.begin({ productReference: "card", query: {} });
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await act(async () => {
        void teleporter.handleReturn("closed");
        await vi.advanceTimersByTimeAsync(1_000);
      });
      paid = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(result.current.teleport.status).not.toBe("waiting");
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(window, "app");
    }
  });

  it("shows the page's failure even when the checkout's status cannot be read", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const failure = { code: "card_declined", declineCode: "insufficient_funds" };
      const replies: Record<string, unknown> = {
        "checkout/teleport": {
          teleportId: "v1:tp",
          url: "https://acme.superwall.app/sw-teleport/v1:tp",
        },
        "checkout/teleport/status": { status: "claimed", checkoutContextId: "ctx_1" },
        "checkout/teleport/session": { saved: true },
        "checkout/teleport/session/read": {
          session: { query: {}, returned: { failure, at: Number.MAX_SAFE_INTEGER } },
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = new URL(url).pathname.replace(/^.*\/public\/v1\//, "");
          if (path === "checkout/status") throw new Error("offline");
          return new Response(JSON.stringify(replies[path] ?? {}));
        }),
      );
      Reflect.set(window, "app", {});
      const onFailure = vi.fn();
      const { result } = renderWithProvider(
        () => ({
          session: useSuperwallSession(),
          teleport: useTeleport(),
          buyer: usePurchase({ onFailure }),
        }),
        {
          config,
          host: {
            device,
            products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
          },
        },
      );
      await flush();
      const teleporter = teleportFor(result.current.session);
      if (teleporter.kind !== "app") throw new Error("expected the app half");
      await act(async () => {
        void teleporter.begin({ productReference: "primary", query: {} });
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await act(async () => {
        void teleporter.handleReturn("failed");
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(result.current.teleport).toMatchObject({
        status: "waiting",
        failure: { reason: "insufficient_funds" },
      });
      expect(result.current.buyer.failure).toMatchObject({ reason: "insufficient_funds" });
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "insufficient_funds" }),
      );
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(window, "app");
    }
  });

  it("reports the page's failure before onReturnData, so cancelling there still settles failed", async () => {
    vi.useFakeTimers();
    try {
      const failure = { code: "card_declined", declineCode: "insufficient_funds" };
      const replies: Record<string, unknown> = {
        "checkout/teleport": {
          teleportId: "v1:tp",
          url: "https://acme.superwall.app/sw-teleport/v1:tp",
        },
        "checkout/teleport/status": { status: "claimed", checkoutContextId: "ctx_1" },
        "checkout/status": { status: "pending" },
        "checkout/teleport/session": { saved: true },
        "checkout/teleport/session/read": {
          session: {
            query: {},
            returned: { failure, data: { offer: "app_store" }, at: Number.MAX_SAFE_INTEGER },
          },
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = new URL(url).pathname.replace(/^.*\/public\/v1\//, "");
          return new Response(JSON.stringify(replies[path] ?? {}));
        }),
      );
      Reflect.set(window, "app", {});
      const onFailure = vi.fn();
      const holder: { cancel?: () => void } = {};
      const { result } = renderWithProvider(
        () => {
          const teleport = useTeleport({ onReturnData: () => holder.cancel?.() });
          if (teleport.status === "waiting") holder.cancel = teleport.cancel;
          return { session: useSuperwallSession(), teleport, buyer: usePurchase({ onFailure }) };
        },
        {
          config,
          host: {
            device,
            products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
          },
        },
      );
      await flush();
      const teleporter = teleportFor(result.current.session);
      if (teleporter.kind !== "app") throw new Error("expected the app half");
      let outcome: unknown;
      await act(async () => {
        void teleporter.begin({ productReference: "primary", query: {} }).then((settled) => {
          outcome = settled;
        });
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await act(async () => {
        void teleporter.handleReturn("failed");
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(onFailure).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ reason: "insufficient_funds" }),
      );
      expect(result.current.buyer.failure).toMatchObject({ reason: "insufficient_funds" });
      expect(outcome).toBeDefined();
      expect(result.current.teleport.status).not.toBe("waiting");
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(window, "app");
    }
  });

  it("reports the same decline again when a later trip to the browser returns with it", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const failure = { code: "card_declined", declineCode: "insufficient_funds" };
      let at = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = new URL(url).pathname.replace(/^.*\/public\/v1\//, "");
          const replies: Record<string, unknown> = {
            "checkout/teleport": {
              teleportId: "v1:tp",
              url: "https://acme.superwall.app/sw-teleport/v1:tp",
            },
            "checkout/teleport/status": { status: "claimed", checkoutContextId: "ctx_1" },
            "checkout/status": { status: "pending" },
            "checkout/teleport/session": { saved: true },
            "checkout/teleport/session/read": {
              session: { query: {}, returned: { failure, at } },
            },
          };
          return new Response(JSON.stringify(replies[path] ?? {}));
        }),
      );
      Reflect.set(window, "app", {});
      const onFailure = vi.fn();
      const { result } = renderWithProvider(
        () => ({ session: useSuperwallSession(), buyer: usePurchase({ onFailure }) }),
        {
          config,
          host: {
            device,
            products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
          },
        },
      );
      await flush();
      const teleporter = teleportFor(result.current.session);
      if (teleporter.kind !== "app") throw new Error("expected the app half");
      await act(async () => {
        void teleporter.begin({ productReference: "primary", query: {} });
        await vi.advanceTimersByTimeAsync(1_500);
      });
      for (let trip = 0; trip < 2; trip++) {
        if (trip > 0) {
          await act(async () => {
            teleporter.open();
            await vi.advanceTimersByTimeAsync(100);
          });
        }
        at = Date.now() + 50;
        await act(async () => {
          void teleporter.handleReturn("failed");
          await vi.advanceTimersByTimeAsync(300);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
        });
      }
      expect(onFailure).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(window, "app");
    }
  });

  it("reports a decline once when the backend sees it before the page's return arrives", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const failure = { code: "card_declined", declineCode: "insufficient_funds" };
      let pageLeft = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = new URL(url).pathname.replace(/^.*\/public\/v1\//, "");
          const replies: Record<string, unknown> = {
            "checkout/teleport": {
              teleportId: "v1:tp",
              url: "https://acme.superwall.app/sw-teleport/v1:tp",
            },
            "checkout/teleport/status": {
              status: "claimed",
              checkoutContextId: "ctx_1",
              failure,
            },
            "checkout/status": { status: "pending" },
            "checkout/teleport/session": { saved: true },
            "checkout/teleport/session/read": {
              session: pageLeft
                ? { query: {}, returned: { failure, at: Number.MAX_SAFE_INTEGER } }
                : { query: {} },
            },
          };
          return new Response(JSON.stringify(replies[path] ?? {}));
        }),
      );
      Reflect.set(window, "app", {});
      const onFailure = vi.fn();
      const { result } = renderWithProvider(
        () => ({ session: useSuperwallSession(), buyer: usePurchase({ onFailure }) }),
        {
          config,
          host: {
            device,
            products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
          },
        },
      );
      await flush();
      const teleporter = teleportFor(result.current.session);
      if (teleporter.kind !== "app") throw new Error("expected the app half");
      await act(async () => {
        void teleporter.begin({ productReference: "primary", query: {} });
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await act(async () => {
        void teleporter.handleReturn("failed");
        await vi.advanceTimersByTimeAsync(300);
      });
      pageLeft = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(onFailure).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(window, "app");
    }
  });

  it("keeps a __proto__ key in return data as data", async () => {
    const { readPageReturn } = await import("../../src/checkout/teleport/api");
    const read = readPageReturn(
      JSON.parse('{"returned":{"data":{"__proto__":{"offer":"apple_pay"},"plan":"monthly"}}}'),
    );
    expect(JSON.stringify(read)).toBe(
      '{"data":{"__proto__":{"offer":"apple_pay"},"plan":"monthly"}}',
    );
    expect(Object.getPrototypeOf(read?.data)).toBe(Object.prototype);
  });

  it("drops return data that is not plain JSON", async () => {
    const { readPageReturn } = await import("../../src/checkout/teleport/api");
    expect(
      readPageReturn({ returned: { data: { offer: "app_store", plan: ["monthly", 1, null] } } }),
    ).toEqual({ data: { offer: "app_store", plan: ["monthly", 1, null] } });
    expect(readPageReturn({ returned: { data: { nested: { when: new Date(0) } } } })).toEqual({});
    expect(readPageReturn({ returned: { data: { count: Number.NaN } } })).toEqual({});
  });

  it("closes the paywall with close(), which returns nothing", async () => {
    const { result } = renderWithProvider(() => useActions(), { config, host: { device } });
    await flush();
    expect(result.current.close()).toBeUndefined();
  });
});
