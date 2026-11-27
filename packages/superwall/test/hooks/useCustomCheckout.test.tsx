import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallTeleportConfig, TOutgoingMessage } from "@superwall/runtime";
import {
  CustomStoreCheckoutError,
  useCustomCheckout,
  type CustomCheckoutStatus,
} from "../../src/checkout";
import { purchaseEventsFor } from "../../src/checkout/events";
import { isLoading, stopLoading } from "../../src/checkout/loading";
import { teleportFor } from "../../src/checkout/teleport/flow";
import { pageNavigation } from "../../src/checkout/teleport/page";
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
  teleport?: SuperwallTeleportConfig,
) => {
  const outgoing: TOutgoingMessage[] = [];
  const seen: CustomCheckoutStatus[] = [];
  const rendered = renderWithProvider(
    () => {
      const checkout = useCustomCheckout();
      if (seen.at(-1) !== checkout.status) seen.push(checkout.status);
      return { checkout, session: useSuperwallSession() };
    },
    {
      config: {
        ...testConfig,
        products: { monthly: "acme_monthly", planOnly: { billingPlan: "monthly" } },
        ...(teleport === undefined ? {} : { teleport }),
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
  return {
    hook: () => rendered.result.current.checkout,
    seen,
    paywall,
    outgoing,
    events,
  };
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

// What a return link says: where it goes, and its query.
const purchasedLink = (href: string) => {
  const url = new URL(href);
  return { link: `${url.origin}${url.pathname}`, query: Object.fromEntries(url.searchParams) };
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
    const { hook, outgoing, events, seen } = await render();

    const checkout = await hook().start("monthly");

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
    await flush();
    expect(seen.at(-1)).toBe("ready");
  });

  it("starts a checkout of a product the host sent, with no metadata when the store sent none", async () => {
    const { metadata: _, ...bare } = session;
    const calls = routes({ "checkout/custom-store/session": [bare] });
    const { hook } = await render([{ reference: "monthly", productId: "custom|host_monthly" }]);

    await expect(hook().start("monthly")).resolves.toEqual({ ...bare, product: "monthly" });
    expect(calls[0]!.body).toMatchObject({ productIdentifier: "host_monthly" });
    expect(calls[0]!.body).not.toHaveProperty("teleportId");
  });

  it("refuses a reference neither the host nor the config names, asking nobody", async () => {
    const calls = routes({});
    const { hook, outgoing, seen } = await render();
    await expect(hook().start("yearly")).rejects.toThrow(/No product "yearly"/);
    await expect(hook().start("planOnly")).rejects.toThrow(/No product "planOnly"/);
    expect(calls).toHaveLength(0);
    expect((await customEvents(outgoing)).map((message) => message.event_name)).toEqual([
      "custom_checkout_fail",
      "custom_checkout_fail",
    ]);
    await flush();
    expect(seen).toEqual(["idle", "failed"]);
  });

  it("refuses the Web SDK and a host with no public key, asking nobody", async () => {
    const calls = routes({});
    const { hook } = await render([], {});
    await expect(hook().start("monthly")).rejects.toThrow(/no public API key/);

    window.history.replaceState(null, "", "/?client_surface=web-sdk");
    await expect(hook().start("monthly")).rejects.toThrow(/Web SDK/);
    expect(calls).toHaveLength(0);
  });

  it("starts no second checkout while one is starting", async () => {
    routes({ "checkout/custom-store/session": [session] });
    const { hook } = await render();

    const first = hook().start("monthly");
    const second = hook().start("monthly");
    await expect(second).rejects.toMatchObject({ tag: "in_flight" });
    await expect(first).resolves.toMatchObject({ checkoutContextId: "ctx_1" });
    await expect(hook().start("monthly")).resolves.toMatchObject({
      checkoutContextId: "ctx_1",
    });
  });

  it("reports a refused checkout to the app and throws it", async () => {
    routes({});
    const { hook, outgoing, seen } = await render();

    const refused = hook().start("monthly");
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
    await flush();
    expect(seen.at(-1)).toBe("failed");
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

    const failed = hook().start("monthly");
    await expect(failed).rejects.toBeInstanceOf(CustomStoreCheckoutError);
    await expect(failed).rejects.toThrow("Custom store checkout failed");
    expect((await customEvents(outgoing)).at(-1)).toMatchObject({
      event_name: "custom_checkout_fail",
      message: "Custom store checkout failed",
    });
  });

  it("completes once Superwall sees the purchase, and goes back to ready at the deadline", async () => {
    const calls = routes({
      "checkout/custom-store/session": [session],
      "checkout/custom-store/status": [{ status: "pending" }, { status: "completed" }],
    });
    const { hook, events, seen } = await render();
    const checkout = await hook().start("monthly");

    const completing = hook().complete(checkout, { intervalMs: 1 });
    expect(isLoading()).toBe(true);
    await expect(completing).resolves.toBe("completed");
    expect(isLoading()).toBe(false);
    expect(calls.filter((call) => call.path === "checkout/custom-store/status")).toHaveLength(2);
    expect(calls.at(-1)!.body).toEqual({ checkoutContextId: "ctx_1" });
    expect(events).toEqual(["start:monthly", "complete:monthly"]);
    await flush();
    expect(seen.at(-1)).toBe("completed");

    routes({ "checkout/custom-store/status": [{ status: "pending" }] });
    await expect(hook().complete(checkout, { intervalMs: 1, timeoutMs: 5 })).resolves.toBe(
      "timeout",
    );
    await flush();
    expect(seen.at(-1)).toBe("ready");
  });

  it("reports each step of the checkout in its status", async () => {
    // Holds each request open, so every step renders before the next.
    const held: ((answer: unknown) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => held.push((answer) => resolve(Response.json(answer)))),
      ),
    );
    const { hook, seen } = await render();

    const starting = hook().start("monthly");
    await flush();
    expect(hook().status).toBe("preparing");
    held.shift()!(session);
    const checkout = await starting;
    await flush();
    expect(hook().status).toBe("ready");

    const completing = hook().complete(checkout);
    await flush();
    expect(hook().status).toBe("confirming");
    held.shift()!({ status: "completed" });
    await completing;
    await flush();
    expect(seen).toEqual(["idle", "preparing", "ready", "confirming", "completed"]);
  });

  it("settles abandoned when Superwall reports the checkout abandoned", async () => {
    routes({ "checkout/custom-store/status": [{ status: "abandoned" }] });
    const { hook, events, seen } = await render([], {});

    await expect(hook().complete({ ...session, product: "monthly" })).resolves.toBe("abandoned");
    expect(events).toEqual(["abandon:monthly"]);
    await flush();
    expect(seen.at(-1)).toBe("abandoned");
  });

  it("reports a checkout the buyer gave up on", async () => {
    const { hook, events, seen } = await render();
    hook().abandon({ ...session, product: "monthly" });
    expect(events).toEqual(["abandon:monthly"]);
    await flush();
    expect(seen).toEqual(["idle", "abandoned"]);
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

  describe("on a teleport page", () => {
    const appLink = "https://acme.superwall.link/app-link/superwall/return";
    const bootPage = () =>
      Reflect.set(window, "__SW_TELEPORT__", {
        id: "s2.tp",
        route: "checkout",
        returnUrl: "myapp://superwall/return",
        appLinkUrl: appLink,
      });
    const purchased = {
      link: appLink,
      query: {
        reason: "purchased",
        product_identifier: "custom|acme_monthly",
        should_dismiss: "true",
      },
    };

    afterEach(() => {
      document.body.replaceChildren();
    });

    it("goes back to the app at once for a direct completion", async () => {
      bootPage();
      const calls = routes({
        "checkout/custom-store/session": [session],
        "checkout/custom-store/status": [{ status: "completed" }],
      });
      const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
      const { hook } = await render([], undefined, { route: "checkout", completion: "direct" });
      const checkout = await hook().start("monthly");

      await expect(hook().complete(checkout)).resolves.toBe("completed");

      expect(purchasedLink(String(go.mock.lastCall?.[0]))).toEqual(purchased);
      expect(document.querySelector(".sw-teleport[role=status]")).toBeNull();
      // Superwall already marked it paid; Stripe's completion is never asked.
      expect(calls.map((call) => call.path)).not.toContain("checkout/session/complete");
    });

    it("shows that the buyer is all set for a confirmation completion", async () => {
      bootPage();
      routes({
        "checkout/custom-store/session": [session],
        "checkout/custom-store/status": [{ status: "completed" }],
      });
      const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
      const { hook } = await render([], undefined, { route: "checkout" });
      const checkout = await hook().start("monthly");

      await expect(hook().complete(checkout)).resolves.toBe("completed");

      expect(go).not.toHaveBeenCalled();
      const screen = document.querySelector(".sw-teleport[role=status]");
      expect(screen?.querySelector(".sw-teleport-title")?.textContent).toBe("You're all set");
      const back = screen?.querySelector<HTMLAnchorElement>("a.sw-teleport-primary");
      expect(purchasedLink(String(back?.href))).toEqual(purchased);
    });

    it("keeps the page's own check from covering the store's checkout before complete", async () => {
      bootPage();
      routes({
        "checkout/custom-store/session": [session],
        "checkout/custom-store/status": [{ status: "completed" }],
        "checkout/teleport/status": [
          {
            status: "completed",
            checkoutContextId: "ctx_1",
            checkoutProductIdentifier: "custom|acme_monthly",
            customTransactionId: "txn_1",
          },
        ],
      });
      const { hook, paywall } = await render([], undefined, { route: "checkout" });
      const checkout = await hook().start("monthly");

      // The store's event is in, and the page checks the teleport (a tab coming back to view).
      const page = teleportFor(paywall);
      if (page.kind !== "page") throw new Error("not a teleport page");
      await expect(page.checkSettled()).resolves.toBe(false);
      expect(document.querySelector(".sw-teleport[role=status]")).toBeNull();

      await hook().complete(checkout);
      const screen = document.querySelector(".sw-teleport[role=status]");
      expect(screen?.querySelector(".sw-teleport-title")?.textContent).toBe("You're all set");
      expect(page.getStatus()).toMatchObject({ paidElsewhere: false });
    });

    it("lets the page settle a purchase made on the store's page it was sent to", async () => {
      vi.useFakeTimers();
      bootPage();
      routes({
        "checkout/custom-store/session": [session],
        "checkout/teleport/status": [
          {
            status: "completed",
            checkoutContextId: "ctx_1",
            checkoutProductIdentifier: "custom|acme_monthly",
            customTransactionId: "txn_1",
          },
        ],
      });
      vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
      const { hook, paywall } = await render([], undefined, { route: "checkout" });
      const checkout = await hook().start("monthly");

      hook().openCheckoutUrl(checkout);
      // Back from the store's page with this page's state kept (back-forward cache).
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      const page = teleportFor(paywall);
      if (page.kind !== "page") throw new Error("not a teleport page");
      await expect(page.checkSettled()).resolves.toBe(true);
    });

    it("names a product the paywall doesn't know by its reference", async () => {
      bootPage();
      routes({ "checkout/custom-store/status": [{ status: "completed" }] });
      const { hook } = await render([], undefined, { route: "checkout" });

      await hook().complete({ ...session, product: "yearly" });

      const back = document.querySelector<HTMLAnchorElement>(
        ".sw-teleport[role=status] a.sw-teleport-primary",
      );
      expect(purchasedLink(String(back?.href)).query.product_identifier).toBe("custom|yearly");
    });
  });
});
