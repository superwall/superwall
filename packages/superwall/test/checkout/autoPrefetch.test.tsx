import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallCheckoutConfig } from "@superwall/runtime";
import { useSuperwallSession } from "../../src/hooks";
import { useAutoPrefetch } from "../../src/checkout/hooks/useAutoPrefetch";
import { controllerFor } from "../../src/checkout/services/registry";
import { sessionCache } from "../../src/checkout/services/SessionCache";
import { flush, renderWithProvider, testConfig } from "../helpers";

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
      const controller = controllerFor(session);
      if (!vi.isMockFunction(controller.prefetchCheckout)) {
        vi.spyOn(controller, "prefetchCheckout").mockImplementation(async (options) => {
          prefetched.push(options);
          return null;
        });
      }
      useAutoPrefetch();
      return session;
    },
    {
      config: { ...testConfig, checkout },
      host: { products, device: { publicApiKey: "pk_test" } },
    },
  );
  await flush();
  return { ...rendered, prefetched };
};

afterEach(() => {
  vi.restoreAllMocks();
  sessionCache.clear();
});

describe("useAutoPrefetch", () => {
  it("warms every Stripe product for Apple Pay, since the wallet is prepared per product", async () => {
    const { prefetched } = await render("applePay");
    expect(prefetched).toEqual([
      expect.objectContaining({
        referenceName: "primary",
        mode: "applePay",
        cacheScope: "apple-pay",
      }),
      expect.objectContaining({
        referenceName: "secondary",
        mode: "applePay",
        cacheScope: "apple-pay",
      }),
    ]);
  });

  it("warms one product for the sheet, the configured one first", async () => {
    const { prefetched } = await render({ mode: "sheet", prefetch: "secondary" });
    expect(prefetched).toEqual([
      expect.objectContaining({ referenceName: "secondary", mode: "sheet", cacheScope: "default" }),
    ]);
  });

  it("does nothing when prefetch is off, or without web checkout", async () => {
    expect((await render({ mode: "applePay", prefetch: false })).prefetched).toEqual([]);
    expect((await render(undefined)).prefetched).toEqual([]);
  });
});
