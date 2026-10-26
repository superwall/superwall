import { afterEach, describe, expect, it, vi } from "vitest";
import { readTeleportBoot, seedTeleportUrl } from "../../../src/checkout/teleport/boot";

const boot = (value: unknown) => Reflect.set(window, "__SW_TELEPORT__", value);

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "__SW_TELEPORT__");
  window.history.replaceState(null, "", "/");
});

describe("readTeleportBoot", () => {
  it("is nothing on a page the worker didn't make into a teleport", () => {
    expect(readTeleportBoot()).toBeUndefined();
    boot({ id: "v1:tp" });
    expect(readTeleportBoot()).toBeUndefined();
    boot({ route: "checkout" });
    expect(readTeleportBoot()).toBeUndefined();
    boot("v1:tp");
    expect(readTeleportBoot()).toBeUndefined();
  });

  it("reads what the worker injected, keeping only links that can be opened", () => {
    boot({
      id: "v1:tp",
      route: "checkout",
      returnUrl: "myapp://superwall/return",
      appLinkUrl: "javascript:alert(1)",
      productReference: "card",
      session: { query: { goal: "sleep", sw_nav: "index", count: 3 } },
    });
    expect(readTeleportBoot()).toEqual({
      id: "v1:tp",
      route: "checkout",
      returnUrl: "myapp://superwall/return",
      productReference: "card",
      query: { goal: "sleep" },
      loadSession: false,
    });

    boot({
      id: "v1:tp",
      route: "checkout",
      returnUrl: "not a url",
      appLinkUrl: "data:text/html,x",
      session: { query: "x" },
    });
    expect(readTeleportBoot()).toEqual({
      id: "v1:tp",
      route: "checkout",
      query: {},
      loadSession: false,
    });
  });

  it("asks for the saved flow only when the worker sent none with a link boot", () => {
    boot({ id: "v1:tp", route: "checkout", loadSession: true });
    expect(readTeleportBoot()?.loadSession).toBe(true);
    boot({ id: "v1:tp", route: "checkout", loadSession: true, session: { query: {} } });
    expect(readTeleportBoot()?.loadSession).toBe(false);
    boot({ id: "v1:tp", route: "checkout", loadSession: "yes" });
    expect(readTeleportBoot()?.loadSession).toBe(false);
  });

  it("takes the product tapped since from the link's fragment, when it is a reference", () => {
    boot({ id: "v1:tp", route: "checkout", productReference: "card" });
    window.history.replaceState(null, "", "/#ref=annual&o=1");
    expect(readTeleportBoot()?.productReference).toBe("annual");
    window.history.replaceState(null, "", "/#ref=not%20a%20ref");
    expect(readTeleportBoot()?.productReference).toBe("card");
  });

  it("is nothing where there is no window", () => {
    vi.stubGlobal("window", undefined);
    expect(readTeleportBoot()).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe("seedTeleportUrl", () => {
  it("opens the page on the teleported route with the flow's state, keeping what the link carries", () => {
    boot({ id: "v1:tp", route: "checkout", session: { query: { goal: "sleep", plan: "app" } } });
    window.history.replaceState(null, "", "/sw-teleport/1?sw_doc=d&plan=link#ref=card");
    seedTeleportUrl(["index", "checkout"]);
    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/sw-teleport/1");
    expect(url.searchParams.get("sw_nav")).toBe("checkout");
    expect(url.searchParams.get("goal")).toBe("sleep");
    expect(url.searchParams.get("plan")).toBe("link");
    expect(url.hash).toBe("#ref=card");
  });

  it("leaves a reloaded page, a route the surface lacks, and a plain page alone", () => {
    seedTeleportUrl(["checkout"]);
    expect(window.location.search).toBe("");

    boot({ id: "v1:tp", route: "checkout" });
    seedTeleportUrl(["index"]);
    expect(window.location.search).toBe("");

    window.history.replaceState(null, "", "/?sw_nav=checkout,plans");
    seedTeleportUrl(["checkout", "plans"]);
    expect(window.location.search).toBe("?sw_nav=checkout,plans");
  });

  it("gives up quietly when the history refuses the write", () => {
    boot({ id: "v1:tp", route: "checkout" });
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => seedTeleportUrl(["checkout"])).not.toThrow();
  });
});
