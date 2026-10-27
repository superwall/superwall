import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallConfig, SuperwallSession, TOutgoingMessage } from "@superwall/runtime";
import { TeleportScreen } from "../../../src/checkout";
import { pageNavigation, teleportFor } from "../../../src/checkout/teleport/flow";
import {
  usePurchase,
  useSuperwallSession,
  useTeleport,
  type UseTeleportOptions,
  type UseTeleportResult,
} from "../../../src/hooks";
import { isLoading, startLoading } from "../../../src/checkout/loading";
import { followTeleportPage } from "../../../src/checkout/flow";
import { createWrapper, flush } from "../../helpers";

const products = [
  { reference: "card", productId: "live:price_1:14days-free" },
  { reference: "annual", productId: "pro_year", variables: { price: "$39.99" } },
];

const stubApi = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("checkout/teleport")
              ? { teleportId: "v1:tp", url: "https://acme.superwall.app/sw-teleport/v1:tp" }
              : { status: "pending" },
          ),
        ),
    ),
  );

const mount = async (
  config: SuperwallConfig,
  device: Record<string, unknown> = {},
  callbacks: UseTeleportOptions = {},
  user: Record<string, string> = {},
) => {
  const outgoing: string[] = [];
  const captured: {
    session?: SuperwallSession;
    teleport?: UseTeleportResult;
    purchase?: ReturnType<typeof usePurchase>["purchase"];
  } = {};
  const Probe = () => {
    captured.session = useSuperwallSession();
    captured.teleport = useTeleport(callbacks);
    captured.purchase = usePurchase().purchase;
    return null;
  };
  const Wrapper = createWrapper({
    config,
    host: {
      products,
      device: {
        platform: "iOS",
        publicApiKey: "pk_test",
        sdkVersionPadded: "004.018.000",
        ...device,
      },
      user,
      onOutgoing: (message: TOutgoingMessage) => outgoing.push(message.event_name),
    },
  });
  render(
    <Wrapper>
      <Probe />
      <TeleportScreen />
    </Wrapper>,
  );
  await flush();
  if (!captured.session) throw new Error("no session");
  return {
    session: captured.session,
    teleport: () => captured.teleport,
    purchase: (reference: string) => captured.purchase?.(reference as never),
    outgoing,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
  document.querySelectorAll(".sw-teleport").forEach((node) => node.remove());
  document.documentElement.style.overflow = "";
  document.documentElement.style.overscrollBehavior = "";
  for (const node of document.body.children) node.removeAttribute("inert");
});

describe("preparing the teleport", () => {
  it("prepares the paywall's route once it opens, and any route the paywall asks for", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("checkout/teleport")) bodies.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            teleportId: "v1:tp",
            url: "https://acme.superwall.app/sw-teleport/v1:tp",
          }),
        );
      }),
    );
    const { teleport } = await mount({
      products: { card: "live:price_1:14days-free" },
      teleport: { route: "checkout" },
    });
    expect(bodies).toEqual([expect.objectContaining({ route: "checkout" })]);

    await act(async () => {
      teleport()?.prefetch("plans");
      await Promise.resolve();
    });
    expect(bodies[1]).toMatchObject({ route: "plans", session: { query: {} } });
    teleport()?.returnToApp();
  });
});

describe("the teleport screen in the app", () => {
  it("goes up over the paywall and offers the browser, the store fallback and cancel", async () => {
    stubApi();
    const { session, teleport, outgoing } = await mount({
      products: { card: "live:price_1:14days-free", annual: "pro_year" },
      teleport: { route: "checkout", fallbacks: { card: "annual" } },
    });
    expect(teleport()).toMatchObject({ status: "idle" });
    expect(screen.queryByRole("dialog")).toBeNull();

    let outcome: Promise<unknown> = Promise.resolve();
    await act(async () => {
      outcome = teleportFor(session).begin({ productReference: "card", query: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await teleportFor(session).showWaitingScreen();
    });

    const dialog = screen.getByRole("dialog", { name: "Finish in your browser" });
    expect(dialog.getAttribute("data-state")).toBe("open");
    expect(dialog.hasAttribute("data-instant")).toBe(true);
    expect(document.activeElement).toBe(dialog);
    expect(document.documentElement.style.overflow).toBe("hidden");
    const siblings = [...document.body.children].filter((node) => node !== dialog);
    expect(siblings.every((node) => node.hasAttribute("inert"))).toBe(true);
    expect(teleport()).toMatchObject({
      status: "waiting",
      productReference: "card",
      fallbackReference: "annual",
    });

    fireEvent.click(screen.getByRole("button", { name: "Complete in Browser" }));
    expect(outgoing.slice(-2)).toEqual(["haptic_feedback", "open_url_external"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue In-App Instead" }));
    });
    await expect(outcome).resolves.toMatchObject({ reference: "annual" });
    expect(document.querySelector(".sw-teleport")?.getAttribute("data-state")).toBe("closing");
    expect(document.documentElement.style.overflow).toBe("");
    expect([...document.body.children].some((node) => node.hasAttribute("inert"))).toBe(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      outcome = teleportFor(session).begin({ productReference: "card", query: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await teleportFor(session).showWaitingScreen();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    await expect(outcome).resolves.toBe("abandoned");
  });

  it("offers no fallback the paywall didn't name, and speaks the device's language", async () => {
    stubApi();
    const { session, teleport } = await mount(
      { products: { card: "live:price_1:14days-free" }, teleport: { route: "checkout" } },
      { deviceLocale: "es_ES" },
    );
    await act(async () => {
      void teleportFor(session).begin({ productReference: "card", query: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await teleportFor(session).showWaitingScreen();
    });
    expect(screen.getByRole("dialog", { name: "Termina en tu navegador" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(teleport()).not.toHaveProperty("fallbackReference");
  });
});

const bootWebHalf = (returnUrl?: string) =>
  Reflect.set(window, "__SW_TELEPORT__", {
    id: "v1:tp",
    route: "checkout",
    productReference: "card",
    ...(returnUrl ? { returnUrl } : {}),
  });

describe("the success screen on the web", () => {
  it("says the purchase is complete and returns to the app", async () => {
    bootWebHalf("myapp://superwall/return");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
    const { session, teleport } = await mount({
      teleport: { route: "checkout" },
    });
    expect(teleport()).toMatchObject({ status: "arrived", productReference: "card" });

    await act(async () => {
      await teleportFor(session).completePurchase("ctx");
    });

    const status = screen.getByRole("status", { name: "You're all set" });
    expect(status.getAttribute("data-state")).toBe("open");
    expect(screen.getByText("Your purchase is complete.")).toBeTruthy();
    expect(screen.getByText("Superwall")).toBeTruthy();
    const back = screen.getByRole("link", { name: "Return to App" });
    expect(back.getAttribute("href")).toBe("myapp://superwall/return?reason=purchased");
    expect(teleport()).toMatchObject({ status: "completed", paidElsewhere: false });

    teleport()?.returnToApp();
    expect(go).toHaveBeenLastCalledWith("myapp://superwall/return?reason=closed");
  });

  it("returns through the universal link when the app has no URL scheme", async () => {
    Reflect.set(window, "__SW_TELEPORT__", {
      id: "v1:tp",
      route: "checkout",
      appLinkUrl: "https://acme.superwall.link/app-link/superwall/return",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
    const { session } = await mount({ teleport: { route: "checkout" } });
    await act(async () => {
      await teleportFor(session).completePurchase("ctx");
    });

    expect(screen.getByText("Your purchase is complete.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Return to App" }).getAttribute("href")).toBe(
      "https://acme.superwall.link/app-link/superwall/return?reason=purchased",
    );
    expect(go).not.toHaveBeenCalled();
  });

  it("tells the shopper to go back on their own when there is no way back", async () => {
    bootWebHalf();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    const { session } = await mount({ teleport: { route: "checkout" } }, { deviceLocale: "he_IL" });
    await act(async () => {
      await teleportFor(session).completePurchase("ctx");
    });
    const status = screen.getByRole("status");
    expect(status.getAttribute("dir")).toBe("rtl");
    expect(screen.queryByRole("link", { name: /./ })).toBe(
      screen.queryByRole("link", { name: /Superwall/ }),
    );
  });

  it("renders nothing for a paywall without a teleport", async () => {
    await mount({});
    expect(document.querySelector(".sw-teleport")).toBeNull();
  });
});

describe("following a teleport from the paywall", () => {
  it("calls back on open, return, cancel and completion", async () => {
    let checks = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("checkout/teleport")) {
          return new Response(
            JSON.stringify({
              teleportId: "v1:tp",
              url: "https://acme.superwall.app/sw-teleport/v1:tp",
            }),
          );
        }
        checks += 1;
        return new Response(
          JSON.stringify(
            checks > 2 ? { status: "completed", checkoutContextId: "c" } : { status: "pending" },
          ),
        );
      }),
    );
    const callbacks = {
      onOpen: vi.fn(),
      onReturn: vi.fn(),
      onCancel: vi.fn(),
      onComplete: vi.fn(),
    };
    const { session } = await mount(
      { products: { card: "live:price_1:14days-free" }, teleport: { route: "checkout" } },
      {},
      callbacks,
    );
    await act(async () => {
      void teleportFor(session).begin({ productReference: "card", query: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(callbacks.onOpen).toHaveBeenCalledOnce();
    await act(async () => {
      void teleportFor(session).handleReturn("closed");
      await Promise.resolve();
    });
    expect(callbacks.onReturn).toHaveBeenCalledOnce();
    await act(async () => {
      teleportFor(session).cancel();
    });
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100));
    });
    expect(callbacks.onComplete).toHaveBeenCalledOnce();
  });
});

describe("buying on the teleport page", () => {
  it("refuses a store product, and a Stripe one once the presentation was paid elsewhere", async () => {
    Reflect.set(window, "__SW_TELEPORT__", { id: "v1:tp", route: "checkout", shared: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "completed", checkoutContextId: "elsewhere" })),
      ),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { purchase, teleport } = await mount({
      products: { card: "live:price_1:14days-free", annual: "pro_year" },
      checkout: "sheet",
      teleport: { route: "checkout" },
    });

    await act(async () => {
      await expect(purchase("annual")).resolves.toMatchObject({ status: "failed" });
    });
    expect(warn).toHaveBeenCalledWith(
      'A teleport page sells only Stripe products, so "annual" can\'t be bought here.',
    );
    await act(async () => {
      await expect(purchase("card")).resolves.toMatchObject({ status: "abandoned" });
    });
    expect(teleport()).toMatchObject({ status: "completed", paidElsewhere: true });
  });
});

describe("the teleport page follows the app", () => {
  it("takes the trial offer and email the app sent, swaps the offer from the link, and clears a loader on a back-forward return", async () => {
    Reflect.set(window, "__SW_TELEPORT__", {
      id: "v1:tp",
      route: "checkout",
      hasIntroductoryOffer: true,
      email: "ada@example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "pending" }))),
    );
    const { session } = await mount({
      products: { card: "live:price_1:14days-free" },
      teleport: { route: "checkout" },
    });
    expect(session.getSnapshot().introductoryOffer.eligible).toBe(true);
    expect(session.getSnapshot().user.email).toBe("ada@example.com");

    await act(async () => {
      window.location.hash = "#t=0";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(session.getSnapshot().introductoryOffer.eligible).toBe(false);
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(session.getSnapshot().introductoryOffer.eligible).toBe(false);

    startLoading();
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    expect(isLoading()).toBe(true);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(isLoading()).toBe(false);
    window.location.hash = "";
  });

  it("keeps an email the paywall already has, and does nothing off the teleport page", async () => {
    Reflect.set(window, "__SW_TELEPORT__", {
      id: "v1:tp",
      route: "checkout",
      email: "new@example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "pending" }))),
    );
    const { session } = await mount(
      { teleport: { route: "checkout" } },
      {},
      {},
      {
        email: "kept@example.com",
      },
    );
    expect(session.getSnapshot().user.email).toBe("kept@example.com");

    await act(async () => {
      session.setUserAttributes({ email: "" });
    });
    const stop = followTeleportPage(session);
    expect(session.getSnapshot().user.email).toBe("new@example.com");
    stop();
    Reflect.deleteProperty(window, "__SW_TELEPORT__");
    followTeleportPage(session)();
  });
});
