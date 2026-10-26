import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuperwallConfig, TOutgoingMessage } from "@superwall/runtime";
import { pageNavigation, teleportFor } from "../../src/checkout/teleport/flow";
import { useActions, usePurchase, useSuperwallSession } from "../../src/hooks";
import { PaywallRouter, useQueryState, useRouter, type RouteMap } from "../../src/navigation/index";
import { createWrapper, flush } from "../helpers";

const config: SuperwallConfig = {
  products: { card: "live:price_1:14days-free", annual: "pro_year" },
  teleport: { route: "checkout", fallbacks: { card: "annual" } },
};

const products = [
  { reference: "card", productId: "live:price_1:14days-free" },
  { reference: "annual", productId: "pro_year", variables: { price: "$39.99" } },
];

const appDevice = { platform: "iOS", publicApiKey: "pk_test", sdkVersionPadded: "004.018.000" };

type Captured = {
  router?: ReturnType<typeof useRouter>;
  purchase?: ReturnType<typeof usePurchase>["purchase"];
  close?: () => void;
  session?: ReturnType<typeof useSuperwallSession>;
};

const captured: Captured = {};

const Page = ({ name }: { name: string }) => {
  captured.router = useRouter();
  captured.purchase = usePurchase().purchase;
  captured.close = useActions().close;
  captured.session = useSuperwallSession();
  const [goal, setGoal] = useQueryState("goal");
  return (
    <div>
      <p>{name}</p>
      <p>goal:{goal ?? "none"}</p>
      <button type="button" onClick={() => setGoal("sleep")}>
        answer
      </button>
    </div>
  );
};

const routes: RouteMap = {
  index: { default: () => <Page name="index" /> },
  checkout: { default: () => <Page name="checkout" /> },
  plans: { default: () => <Page name="plans" /> },
};

const mount = async (device: Record<string, unknown> = appDevice) => {
  const outgoing: TOutgoingMessage[] = [];
  const Wrapper = createWrapper({
    config,
    host: { products, device, onOutgoing: (message) => outgoing.push(message) },
  });
  render(
    <Wrapper>
      <PaywallRouter routes={routes} transition="none" />
    </Wrapper>,
  );
  await flush();
  return outgoing;
};

const stubApi = () => {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify(
          url.endsWith("checkout/teleport")
            ? { teleportId: "v1:tp", url: "https://acme.superwall.app/sw-teleport/v1:tp" }
            : { status: "pending" },
        ),
      );
    }),
  );
  return bodies;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
  window.history.replaceState(null, "", "/");
});

describe("teleporting from the app", () => {
  it("opens the web instead of pushing the teleport route, carrying the flow's answers", async () => {
    const bodies = stubApi();
    const outgoing = await mount();
    fireEvent.click(screen.getByRole("button", { name: "answer" }));

    await act(async () => {
      captured.router?.push("checkout");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("index")).toBeTruthy();
    expect(bodies[0]).toMatchObject({ route: "checkout", session: { query: { goal: "sleep" } } });
    expect(outgoing.map((message) => message.event_name)).toContain("open_url_external");

    await act(async () => captured.router?.push("plans"));
    expect(screen.getByText("plans")).toBeTruthy();
  });

  it("pushes the route as usual on an SDK that cannot teleport", async () => {
    await mount({ ...appDevice, sdkVersionPadded: "004.017.000" });
    await act(async () => captured.router?.push("checkout"));
    expect(screen.getByText("checkout")).toBeTruthy();
  });

  it("teleports a Stripe purchase and resolves it once settled, or buys the fallback natively", async () => {
    stubApi();
    await mount();
    const session = captured.session;
    if (!session) throw new Error("no session");

    let result: Promise<unknown> = Promise.resolve();
    await act(async () => {
      result = captured.purchase?.("card") ?? Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => teleportFor(session).cancel());
    await expect(result).resolves.toMatchObject({
      status: "abandoned",
      product: { reference: "card" },
    });

    await act(async () => {
      result = captured.purchase?.("card") ?? Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      teleportFor(session).payInApp();
      await flush();
    });
    await expect(result).resolves.toMatchObject({
      status: "completed",
      product: { reference: "annual" },
    });
  });
});

describe("the web half of a teleport", () => {
  const boot = () =>
    Reflect.set(window, "__SW_TELEPORT__", {
      id: "v1:tp",
      route: "checkout",
      returnUrl: "myapp://superwall/return",
      session: { query: { goal: "sleep" } },
    });

  it("opens on the teleported route with the answers, and goes back to the app from it", async () => {
    boot();
    const go = vi.spyOn(pageNavigation, "assign").mockImplementation(() => undefined);
    await mount({ platform: "iOS", publicApiKey: "pk_test" });

    expect(screen.getByText("checkout")).toBeTruthy();
    expect(screen.getByText("goal:sleep")).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get("sw_nav")).toBe("checkout");
    expect(captured.router?.canGoBack()).toBe(true);

    await act(async () => captured.router?.push("plans"));
    expect(screen.getByText("plans")).toBeTruthy();
    await act(async () => captured.router?.back());
    expect(screen.getByText("checkout")).toBeTruthy();
    expect(go).not.toHaveBeenCalled();

    await act(async () => captured.router?.back());
    expect(go).toHaveBeenCalledWith("myapp://superwall/return?reason=closed");

    captured.close?.();
    expect(go).toHaveBeenCalledTimes(2);
  });

  it("closes the paywall as usual off the web half", async () => {
    const outgoing = await mount();
    captured.close?.();
    expect(outgoing.map((message) => message.event_name)).toContain("close");
  });
});
