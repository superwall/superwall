import { afterEach, describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { CustomStoreCheckoutError, useCustomCheckout } from "../../src/checkout";
import { purchaseEventsFor } from "../../src/checkout/events";
import { isLoading, stopLoading } from "../../src/checkout/loading";
import { useSuperwallSession } from "../../src/hooks";
import { flush, renderWithProvider, testConfig } from "../helpers";

// The page-driven custom store checkout: start a checkout and stay on the page, then wait for
// Superwall to see the purchase.

const session = {
  checkoutContextId: "ctx_1",
  checkoutUrl: "https://store.example.com/checkout/ch_1/",
  customTransactionId: "txn_1",
  metadata: { checkout_id: "ch_1" },
};

const render = async (
  products: { reference: string; productId: string }[] = [],
  device: Record<string, unknown> = { publicApiKey: "pk_test" },
) => {
  const outgoing: TOutgoingMessage[] = [];
  const rendered = renderWithProvider(
    () => ({ checkout: useCustomCheckout(), session: useSuperwallSession() }),
    {
      config: {
        ...testConfig,
        products: { monthly: "acme_monthly", planOnly: { billingPlan: "monthly" } },
      },
      host: {
        products,
        device: { platform: "iOS", ...device },
        onOutgoing: (message) => outgoing.push(message),
      },
    },
  );
  await flush();
  const { session: paywall } = rendered.result.current;
  const events: string[] = [];
  for (const event of ["start", "complete", "abandon"] as const) {
    purchaseEventsFor(paywall).on(event, ({ referenceName }) =>
      events.push(`${event}:${referenceName}`),
    );
  }
  return { hook: () => rendered.result.current.checkout, paywall, outgoing, events };
};

const customEvents = async (outgoing: TOutgoingMessage[]) => {
  await flush();
  return outgoing.filter((message) => message.event_name.startsWith("custom_checkout"));
};

const routes = (answers: Record<string, unknown[]>) => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname.replace(/^.*\/public\/v1\//, "");
      calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      const queue = answers[path] ?? [];
      const answer = queue.length > 1 ? queue.shift() : queue[0];
      return Response.json(answer ?? {}, { status: answer === undefined ? 500 : 200 });
    }),
  );
  return calls;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  stopLoading();
  window.history.replaceState(null, "", "/");
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
});

describe("useCustomCheckout", () => {
  it("starts a teleport page's checkout of a product only the config names, with its metadata", async () => {
    // A teleport page gets no record of a custom store product from its host.
    Reflect.set(window, "__SW_TELEPORT__", { id: "s2.tp", route: "checkout" });
    const calls = routes({ "checkout/custom-store/session": [session] });
    const { hook, outgoing, events } = await render();

    const checkout = await hook().startCheckout("monthly");

    expect(checkout).toEqual({ ...session, product: "monthly" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      productIdentifier: "acme_monthly",
      teleportId: "s2.tp",
    });
    expect(await customEvents(outgoing)).toEqual([
      {
        event_name: "custom_checkout_start",
        product_identifier: "acme_monthly",
        checkout_context_id: "ctx_1",
        custom_transaction_id: "txn_1",
      },
    ]);
    expect(events).toEqual(["start:monthly"]);
    expect(isLoading()).toBe(false);
  });

  it("starts a checkout of a product the host sent, with no metadata when the store sent none", async () => {
    const { metadata: _, ...bare } = session;
    const calls = routes({ "checkout/custom-store/session": [bare] });
    const { hook } = await render([{ reference: "monthly", productId: "custom|host_monthly" }]);

    await expect(hook().startCheckout("monthly")).resolves.toEqual({ ...bare, product: "monthly" });
    expect(calls[0]!.body).toMatchObject({ productIdentifier: "host_monthly" });
    expect(calls[0]!.body).not.toHaveProperty("teleportId");
  });

  it("refuses a reference neither the host nor the config names, asking nobody", async () => {
    const calls = routes({});
    const { hook, outgoing } = await render();
    await expect(hook().startCheckout("yearly")).rejects.toThrow(/No product "yearly"/);
    await expect(hook().startCheckout("planOnly")).rejects.toThrow(/No product "planOnly"/);
    expect(calls).toHaveLength(0);
    expect((await customEvents(outgoing)).map((message) => message.event_name)).toEqual([
      "custom_checkout_fail",
      "custom_checkout_fail",
    ]);
  });

  it("refuses the Web SDK and a host with no public key, asking nobody", async () => {
    const calls = routes({});
    const { hook } = await render([], {});
    await expect(hook().startCheckout("monthly")).rejects.toThrow(/no public API key/);

    window.history.replaceState(null, "", "/?client_surface=web-sdk");
    await expect(hook().startCheckout("monthly")).rejects.toThrow(/Web SDK/);
    expect(calls).toHaveLength(0);
  });

  it("starts no second checkout while one is starting", async () => {
    routes({ "checkout/custom-store/session": [session] });
    const { hook } = await render();

    const first = hook().startCheckout("monthly");
    const second = hook().startCheckout("monthly");
    await expect(second).rejects.toMatchObject({ tag: "in_flight" });
    await expect(first).resolves.toMatchObject({ checkoutContextId: "ctx_1" });
    await expect(hook().startCheckout("monthly")).resolves.toMatchObject({
      checkoutContextId: "ctx_1",
    });
  });

  it("reports a refused checkout to the app and throws it", async () => {
    routes({});
    const { hook, outgoing } = await render();

    const refused = hook().startCheckout("monthly");
    await expect(refused).rejects.toBeInstanceOf(CustomStoreCheckoutError);
    await expect(refused).rejects.toThrow(/answered 500/);
    expect(await customEvents(outgoing)).toEqual([
      {
        event_name: "custom_checkout_fail",
        product_identifier: "acme_monthly",
        message: "The checkout request answered 500",
      },
    ]);
    expect(isLoading()).toBe(false);
  });

  it("wraps something thrown that is not an Error in a plain failure", async () => {
    routes({ "checkout/custom-store/session": [session] });
    const { hook, paywall, outgoing } = await render();
    const snapshot = paywall.getSnapshot();
    vi.spyOn(paywall, "getSnapshot").mockReturnValue({
      ...snapshot,
      get user(): never {
        throw "boom";
      },
    });

    const failed = hook().startCheckout("monthly");
    await expect(failed).rejects.toBeInstanceOf(CustomStoreCheckoutError);
    await expect(failed).rejects.toThrow("Custom store checkout failed");
    expect((await customEvents(outgoing)).at(-1)).toMatchObject({
      event_name: "custom_checkout_fail",
      message: "Custom store checkout failed",
    });
  });

  it("waits until Superwall sees the purchase, and gives up at the deadline", async () => {
    const calls = routes({
      "checkout/custom-store/session": [session],
      "checkout/custom-store/status": [{ status: "pending" }, { status: "completed" }],
    });
    const { hook, events } = await render();
    const checkout = await hook().startCheckout("monthly");

    await expect(hook().waitForPurchase(checkout, { intervalMs: 1 })).resolves.toBe("completed");
    expect(calls.filter((call) => call.path === "checkout/custom-store/status")).toHaveLength(2);
    expect(calls.at(-1)!.body).toEqual({ checkoutContextId: "ctx_1" });
    expect(events).toEqual(["start:monthly", "complete:monthly"]);

    routes({ "checkout/custom-store/status": [{ status: "pending" }] });
    await expect(hook().waitForPurchase(checkout, { intervalMs: 1, timeoutMs: 5 })).resolves.toBe(
      "timeout",
    );
  });

  it("settles abandoned when Superwall reports the checkout abandoned", async () => {
    routes({ "checkout/custom-store/status": [{ status: "abandoned" }] });
    const { hook, events } = await render([], {});

    await expect(hook().waitForPurchase({ ...session, product: "monthly" })).resolves.toBe(
      "abandoned",
    );
    expect(events).toEqual(["abandon:monthly"]);
  });

  it("reports a checkout the buyer gave up on", async () => {
    const { hook, events } = await render();
    hook().abandon({ ...session, product: "monthly" });
    expect(events).toEqual(["abandon:monthly"]);
  });

  it("sends the browser to the store's checkout page, and stops loading when it comes back", async () => {
    vi.useFakeTimers();
    const { hook } = await render();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    hook().openCheckoutUrl({ ...session, product: "monthly" });
    expect(isLoading()).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(assign).toHaveBeenCalledWith(session.checkoutUrl);

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    expect(isLoading()).toBe(true);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(isLoading()).toBe(false);
  });
});
