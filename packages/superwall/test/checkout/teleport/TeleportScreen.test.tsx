import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallConfig, SuperwallSession, TOutgoingMessage } from "@superwall/runtime";
import { TeleportScreen } from "../../../src/checkout";
import { pageNavigation, teleportFor } from "../../../src/checkout/teleport/flow";
import { useSuperwallSession, useTeleport, type UseTeleportResult } from "../../../src/hooks";
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

const mount = async (config: SuperwallConfig, device: Record<string, unknown> = {}) => {
  const outgoing: string[] = [];
  const captured: { session?: SuperwallSession; teleport?: UseTeleportResult } = {};
  const Probe = () => {
    captured.session = useSuperwallSession();
    captured.teleport = useTeleport();
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
  return { session: captured.session, teleport: () => captured.teleport, outgoing };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
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
      teleportFor(session).showWaitingScreen();
    });

    expect(screen.getByRole("dialog", { name: "Finish in your browser" })).toBeTruthy();
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
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      outcome = teleportFor(session).begin({ productReference: "card", query: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      teleportFor(session).showWaitingScreen();
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
      teleportFor(session).showWaitingScreen();
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
    expect(status.getAttribute("data-state")).toBe("closed");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(status.getAttribute("data-state")).toBe("open");
    expect(screen.getByText("Your purchase is complete.")).toBeTruthy();
    expect(screen.getByText("Superwall")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Return to App" }));
    expect(go).toHaveBeenCalledWith("myapp://superwall/return?reason=purchased");

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
    fireEvent.click(screen.getByRole("button", { name: "Return to App" }));
    expect(go).toHaveBeenCalledWith(
      "https://acme.superwall.link/app-link/superwall/return?reason=purchased",
    );
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
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for a paywall without a teleport", async () => {
    await mount({});
    expect(document.querySelector(".sw-teleport")).toBeNull();
  });
});
