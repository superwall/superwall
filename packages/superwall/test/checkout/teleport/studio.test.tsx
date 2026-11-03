import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuperwallConfig, TOutgoingMessage } from "@superwall/runtime";
import { teleportFor } from "../../../src/checkout/teleport/flow";
import { createStudioTeleporter, provideInlinePush } from "../../../src/checkout/teleport/studio";
import { usePurchase, useSuperwallSession } from "../../../src/hooks";
import { PaywallRouter, useRouter, type RouteMap } from "../../../src/navigation/index";
import { createWrapper, flush } from "../../helpers";

const config: SuperwallConfig = {
  products: { card: "live:price_1:14days-free", annual: "pro_year" },
  teleport: { route: "checkout" },
};

const products = [
  { reference: "card", productId: "live:price_1:14days-free" },
  { reference: "annual", productId: "pro_year" },
];

const studioDevice = { platform: "iOS" };

type Captured = {
  router?: ReturnType<typeof useRouter>;
  purchase?: ReturnType<typeof usePurchase>["purchase"];
  session?: ReturnType<typeof useSuperwallSession>;
};

const captured: Captured = {};

const Page = ({ name }: { name: string }) => {
  captured.router = useRouter();
  captured.purchase = usePurchase().purchase;
  captured.session = useSuperwallSession();
  return <p>{name}</p>;
};

const routes: RouteMap = {
  index: { default: () => <Page name="index" /> },
  checkout: { default: () => <Page name="checkout" /> },
  plans: { default: () => <Page name="plans" /> },
};

const mount = async ({
  device = studioDevice,
  surfaceConfig = config,
}: { device?: Record<string, unknown>; surfaceConfig?: SuperwallConfig } = {}) => {
  const outgoing: TOutgoingMessage[] = [];
  const Wrapper = createWrapper({
    config: surfaceConfig,
    host: {
      products,
      device,
      purchase: "completed",
      onOutgoing: (message) => outgoing.push(message),
    },
  });
  render(
    <Wrapper>
      <PaywallRouter routes={routes} transition="none" />
    </Wrapper>,
  );
  await flush();
  return outgoing;
};

const teleports = (outgoing: TOutgoingMessage[]) =>
  outgoing.filter((message) => message.event_name === "open_url_external");

const statusNow = () => {
  if (!captured.session) throw new Error("no session");
  return teleportFor(captured.session).getStatus();
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  window.history.replaceState(null, "", "/?transport=editor");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("the studio teleport never calls the backend");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("teleporting in the studio", () => {
  it("tells the host it teleported and shows the teleport route inline, without the backend", async () => {
    const outgoing = await mount();

    await act(async () => captured.router?.push("checkout"));

    expect(screen.getByText("checkout")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    const [message] = teleports(outgoing);
    expect(message).toMatchObject({ event_name: "open_url_external", teleport: true });
    const url = new URL(String(Reflect.get(message ?? {}, "url")));
    expect(url.searchParams.get("sw_nav")).toBe("checkout");
    expect(url.searchParams.get("transport")).toBe("editor");
    expect(statusNow()).toEqual({ status: "arrived" });
  });

  it("stays on the web half for pushes there, and returns when going back from its first route", async () => {
    const outgoing = await mount();
    await act(async () => captured.router?.push("plans", { teleport: true }));
    await act(async () => captured.router?.push("checkout"));

    expect(screen.getByText("checkout")).toBeTruthy();
    expect(teleports(outgoing)).toHaveLength(1);

    await act(async () => captured.router?.back());
    expect(screen.getByText("plans")).toBeTruthy();
    expect(statusNow()).toEqual({ status: "arrived" });

    await act(async () => captured.router?.back());
    expect(screen.getByText("index")).toBeTruthy();
    expect(statusNow()).toEqual({ status: "idle" });

    await act(async () => captured.router?.push("checkout"));
    expect(teleports(outgoing)).toHaveLength(2);
  });

  it("returns to the app when a reset leaves the web half", async () => {
    await mount();
    await act(async () => captured.router?.push("checkout"));
    await act(async () => captured.router?.reset([]));

    expect(screen.getByText("index")).toBeTruthy();
    expect(statusNow()).toEqual({ status: "idle" });
  });

  it("teleports a Stripe purchase to the teleport route with the tapped product", async () => {
    const outgoing = await mount();
    let result: Promise<unknown> = Promise.resolve();
    await act(async () => {
      result = captured.purchase?.("card") ?? Promise.resolve();
      await settle();
    });

    expect(screen.getByText("checkout")).toBeTruthy();
    const url = new URL(String(Reflect.get(teleports(outgoing)[0] ?? {}, "url")));
    expect(url.searchParams.get("sw_nav")).toBe("checkout");
    expect(url.searchParams.get("sw_ref")).toBe("card");
    expect(statusNow()).toEqual({ status: "arrived", productReference: "card" });

    await act(async () => captured.router?.back());
    await expect(result).resolves.toMatchObject({
      status: "abandoned",
      product: { reference: "card" },
    });
  });

  it("refuses a teleport route the paywall does not have, without telling the host", async () => {
    const outgoing = await mount({ surfaceConfig: { ...config, teleport: { route: "missing" } } });
    let failure: unknown;
    await act(async () => {
      try {
        await captured.purchase?.("card");
      } catch (error) {
        failure = error;
      }
    });

    expect(String(failure)).toContain('Unknown route "missing"');
    expect(teleports(outgoing)).toHaveLength(0);
    expect(statusNow()).toEqual({ status: "idle" });
    expect(screen.getByText("index")).toBeTruthy();
  });

  it("teleports a purchase to the current route when the paywall names none", async () => {
    const outgoing = await mount({ surfaceConfig: { ...config, teleport: true } });
    await act(async () => captured.router?.push("plans"));
    await act(async () => {
      void captured.purchase?.("card");
      await settle();
    });

    const url = new URL(String(Reflect.get(teleports(outgoing)[0] ?? {}, "url")));
    expect(url.searchParams.get("sw_nav")).toBe("plans");
    expect(captured.router?.name).toBe("plans");
    expect(captured.router?.depth).toBe(2);
  });

  it("settles the app's purchase with the one bought on the web half", async () => {
    await mount();
    let result: Promise<unknown> = Promise.resolve();
    await act(async () => {
      result = captured.purchase?.("card") ?? Promise.resolve();
      await settle();
    });
    await act(async () => {
      await captured.purchase?.("card");
      await flush();
    });

    await expect(result).resolves.toMatchObject({
      status: "completed",
      product: { reference: "card" },
    });
  });

  it("buys store products in the app without teleporting", async () => {
    const outgoing = await mount();
    await act(async () => {
      await captured.purchase?.("annual");
      await flush();
    });

    expect(teleports(outgoing)).toHaveLength(0);
    expect(screen.getByText("index")).toBeTruthy();
  });

  it("pushes as usual on an Android device", async () => {
    const outgoing = await mount({ device: { platform: "Android" } });
    await act(async () => captured.router?.push("checkout"));

    expect(screen.getByText("checkout")).toBeTruthy();
    expect(teleports(outgoing)).toHaveLength(0);
    expect(statusNow()).toEqual({ status: "idle" });
  });

  it("pushes as usual on a paywall without teleport", async () => {
    const outgoing = await mount({ surfaceConfig: { products: config.products } });
    await act(async () => captured.router?.push("checkout", { teleport: true }));

    expect(screen.getByText("checkout")).toBeTruthy();
    expect(teleports(outgoing)).toHaveLength(0);
  });
});

const session = (posted: unknown[] = []) => ({
  getSnapshot: () =>
    ({
      device: { platform: "iOS" },
      config: { teleport: { route: "checkout" } },
    }) as never,
  postMessage: (message: unknown) => {
    posted.push(message);
  },
});

describe("the studio teleporter", () => {
  it("is unavailable, and fails to begin, without a router to push on", async () => {
    const paywall = session();
    const teleporter = createStudioTeleporter(paywall);

    expect(teleporter.available()).toBe(false);
    await expect(teleporter.begin({ query: {} })).resolves.toBe("failed");
  });

  it("forgets a router once it unmounts, but not a newer one", () => {
    const paywall = session();
    const teleporter = createStudioTeleporter(paywall);
    const stale = provideInlinePush(paywall, () => {});
    const remove = provideInlinePush(paywall, () => {});
    stale();
    expect(teleporter.available()).toBe(true);
    remove();
    expect(teleporter.available()).toBe(false);
  });

  it("returns to the app when the paywall closes on the web half", async () => {
    const paywall = session();
    const teleporter = createStudioTeleporter(paywall);
    provideInlinePush(paywall, () => {});
    const returned = vi.fn();
    teleporter.on("return", returned);

    const outcome = teleporter.begin({ query: {} });
    teleporter.endPresentation();

    await expect(outcome).resolves.toBe("abandoned");
    expect(returned).toHaveBeenCalledOnce();
    expect(teleporter.getStatus()).toEqual({ status: "idle" });
  });

  it("does nothing for the app-only actions", async () => {
    const teleporter = createStudioTeleporter(session());
    teleporter.prefetch();
    teleporter.beginPresentation();
    teleporter.refreshIntroductoryOffer();
    teleporter.open();
    teleporter.cancel();
    teleporter.attach({} as never)();

    expect(teleporter.fallback()).toBeUndefined();
    expect(teleporter.inFlight()).toBe(false);
    await expect(teleporter.showWaitingScreen()).resolves.toBe(false);
    await expect(teleporter.handleReturn()).resolves.toBe(false);
  });
});
