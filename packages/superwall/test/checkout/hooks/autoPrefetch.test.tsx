import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { createHostTransport, recordingDelegate } from "@superwall/host";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallCheckoutConfig } from "@superwall/runtime";
import { useSuperwallSession } from "../../../src/hooks";
import { useAutoPrefetch } from "../../../src/checkout/hooks/useAutoPrefetch";
import { sessionsFor } from "../../../src/checkout/flow";
import { SuperwallProvider } from "../../../src";
import { flush, renderWithProvider, testConfig } from "../../helpers";

const products = [
  { reference: "primary", productId: "test:price_1:no-trial" },
  { reference: "secondary", productId: "test:price_2:no-trial" },
  { reference: "store", productId: "pro_999_month" },
];

const render = async (checkout: SuperwallCheckoutConfig | undefined) => {
  const prefetched: unknown[] = [];
  const rendered = renderWithProvider(
    () => {
      const session = useSuperwallSession();
      // Spy before the effect runs, on the controller the effect will use.
      const controller = sessionsFor(session);
      if (!vi.isMockFunction(controller.prefetch)) {
        vi.spyOn(controller, "prefetch").mockImplementation(async (options) => {
          prefetched.push(options);
          return null;
        });
      }
      useAutoPrefetch();
      return session;
    },
    {
      config: { ...testConfig, checkout },
      host: { products, device: { platform: "Android", publicApiKey: "pk_test" } },
    },
  );
  await flush();
  return { ...rendered, prefetched };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAutoPrefetch", () => {
  it("warms every Stripe product for Apple Pay, since the wallet is prepared per product", async () => {
    const { prefetched } = await render("applePay");
    expect(prefetched).toEqual([
      expect.objectContaining({
        referenceName: "primary",
        mode: "applePay",
        scope: "apple-pay",
      }),
      expect.objectContaining({
        referenceName: "secondary",
        mode: "applePay",
        scope: "apple-pay",
      }),
    ]);
  });

  it("warms one product for the sheet, the configured one first", async () => {
    const { prefetched } = await render({ mode: "sheet", prefetch: "secondary" });
    expect(prefetched).toEqual([
      expect.objectContaining({ referenceName: "secondary", mode: "sheet", scope: "default" }),
    ]);
  });

  it("does nothing when prefetch is off, and warms the hosted page with no checkout configured", async () => {
    expect((await render({ mode: "applePay", prefetch: false })).prefetched).toEqual([]);
    expect((await render(undefined)).prefetched).toEqual([
      expect.objectContaining({ referenceName: "primary", mode: "external", scope: "default" }),
    ]);
  });
});

describe("useAutoPrefetch runs once", () => {
  it("does not warm again when the paywall re-renders", async () => {
    const { prefetched, rerender } = await render("sheet");
    expect(prefetched).toHaveLength(1);
    rerender();
    await flush();
    expect(prefetched).toHaveLength(1);
  });
});

describe("useAutoPrefetch and a changing snapshot", () => {
  it("warms once, even after the paywall's products are recomputed", async () => {
    const { result, prefetched } = await render("sheet");
    expect(prefetched).toHaveLength(1);

    await act(async () => {
      result.current.setLocale("de");
      await flush();
    });

    expect(prefetched).toHaveLength(1);
  });
});

describe("useAutoPrefetch inside an app", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("warms nothing until the paywall opens, then once for each time it opens", async () => {
    window.history.replaceState({}, "", "/?transport=editor");
    vi.useFakeTimers();
    const { transport } = createHostTransport({
      latencyMs: 1_000,
      delegate: recordingDelegate({}),
      state: {
        products: products.map((product) => ({ ...product, variables: {} })),
        device: { platform: "Android", publicApiKey: "pk_test" },
      },
    });
    const prefetched: unknown[] = [];
    const { result } = renderHook(
      () => {
        const session = useSuperwallSession();
        const controller = sessionsFor(session);
        if (!vi.isMockFunction(controller.prefetch)) {
          vi.spyOn(controller, "prefetch").mockImplementation(async (options) => {
            prefetched.push(options);
            return null;
          });
        }
        useAutoPrefetch();
        return session;
      },
      {
        wrapper: ({ children }: React.PropsWithChildren) => (
          <SuperwallProvider config={{ ...testConfig, checkout: "sheet" }} transport={transport}>
            {children}
          </SuperwallProvider>
        ),
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(prefetched).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(prefetched).toHaveLength(1);

    await act(async () => {
      result.current.accept([
        { event_name: "paywall_open", paywall_id: "8", paywall_identifier: "again" },
      ]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(prefetched).toHaveLength(2);
  });
});
