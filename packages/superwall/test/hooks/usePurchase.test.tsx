import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { usePurchase } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

const customProducts = [{ reference: "primary", productId: "custom|pro_monthly", variables: {} }];

type Holder = Window & { webPaywallCtrl?: unknown };

const customHost = (messages: TOutgoingMessage[]) => ({
  products: customProducts,
  device: { publicApiKey: "pk_test" },
  onOutgoing: (message: TOutgoingMessage) => messages.push(message),
});

describe("usePurchase", () => {
  it("tracks the purchase lifecycle without userland state", async () => {
    const { result } = renderWithProvider(() => usePurchase());
    await flush();

    expect(result.current.isPurchasing).toBe(false);

    let purchasePromise: Promise<unknown> | undefined;
    act(() => {
      purchasePromise = result.current.purchase("primary");
    });

    expect(result.current.isPurchasing).toBe(true);
    expect(result.current.pendingProduct?.reference).toBe("primary");

    await flush();
    await purchasePromise;

    expect(result.current.isPurchasing).toBe(false);
    expect(result.current.transaction).toMatchObject({
      status: "completed",
      product: { reference: "primary" },
    });
  });

  it("resolves abandonment as a purchase result", async () => {
    const { result } = renderWithProvider(() => usePurchase(), {
      host: { purchase: "abandoned" },
    });
    await flush();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase("primary");
    });

    expect(outcome).toMatchObject({ status: "abandoned" });
    expect(result.current.isPurchasing).toBe(false);
  });

  describe("a custom store product", () => {
    afterEach(() => {
      delete (window as Holder).webPaywallCtrl;
      vi.unstubAllGlobals();
    });

    it("opens the store's checkout on a hosted web paywall instead of asking the controller", async () => {
      (window as Holder).webPaywallCtrl = { props: { clientSurface: "web-direct" } };
      vi.stubGlobal("webkit", { messageHandlers: { paywallMessageHandler: {} } });
      const assign = vi.fn();
      vi.stubGlobal("location", {
        href: "https://acme.superwall.app/pro",
        hostname: "acme.superwall.app",
        search: "",
        hash: "",
        assign,
      });
      const fetchMock = vi.fn(async () =>
        Response.json({
          checkoutContextId: "ctx_1",
          checkoutUrl: "https://pay.vendor.test/c/1",
          customTransactionId: "txn_1",
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const messages: TOutgoingMessage[] = [];
      const { result } = renderWithProvider(() => usePurchase(), { host: customHost(messages) });
      await flush();

      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.purchase("primary");
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/checkout/custom-store/session"),
        expect.anything(),
      );
      expect(assign).toHaveBeenCalledWith("https://pay.vendor.test/c/1");
      expect(outcome).toMatchObject({ status: "abandoned", product: { reference: "primary" } });
      expect(messages.map((message) => message.event_name)).toContain("custom_checkout_start");
      expect(messages.map((message) => message.event_name)).not.toContain("purchase");
    });

    it("still goes to the SDK's purchase inside an app", async () => {
      vi.stubGlobal("webkit", { messageHandlers: { paywallMessageHandler: {} } });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const messages: TOutgoingMessage[] = [];
      const { result } = renderWithProvider(() => usePurchase(), { host: customHost(messages) });
      await flush();

      let outcome: unknown;
      await act(async () => {
        const pending = result.current.purchase("primary");
        await flush();
        outcome = await pending;
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ status: "completed" });
      expect(messages.map((message) => message.event_name)).toContain("purchase");
    });
  });
});
