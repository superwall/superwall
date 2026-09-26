import { renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuperwallProvider, type SuperwallSession } from "../../../src";
import {
  readCachedProductVariables,
  resolveProductVariables,
  useProductVariables,
} from "../../../src/checkout/hooks/useProductVariables";
import { useSuperwallSession } from "../../../src/hooks";
import { createHost, flush, testConfig, type HostProps } from "../../helpers";

const webConfig = {
  ...testConfig,
  checkout: "sheet" as const,
  products: { primary: "test:price_1:no-trial", native: "pro_3999_year" },
};

const init = { apiBase: "https://web-api.superwall.app", placementSessionToken: "pk_web" };

const variables = { identifier: "test:price_1:no-trial", price: "$49.99", periodly: "yearly" };

const stubVariables = () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ products: { "stripe|test:price_1:no-trial": variables } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

const hashOf = (payload: unknown) => `#init=${btoa(JSON.stringify(payload))}`;

const render = (host: HostProps = { products: [], device: { platform: "Web" } }) => {
  const { transport } = createHost(host);
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <SuperwallProvider config={webConfig} transport={transport}>
      {children}
    </SuperwallProvider>
  );
  return renderHook(
    (): SuperwallSession => {
      useProductVariables();
      return useSuperwallSession();
    },
    { wrapper },
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

describe("resolveProductVariables", () => {
  it("asks the paywall API for the Stripe slots' variables, the way paywall.js does", async () => {
    const fetch = stubVariables();

    const supplied = await resolveProductVariables(init, webConfig);

    expect(fetch).toHaveBeenCalledWith("https://web-api.superwall.app/api/products/variables", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer pk_web" },
      body: JSON.stringify({ productIdentifiers: ["stripe|test:price_1:no-trial"] }),
    });
    expect(supplied).toEqual([
      { reference: "primary", productId: "test:price_1:no-trial", variables },
    ]);
  });

  it("fails on an error answer and asks nothing without Stripe slots", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 401 })),
    );
    await expect(resolveProductVariables(init, webConfig)).rejects.toThrow("401");

    const fetch = stubVariables();
    expect(await resolveProductVariables(init, { ...testConfig, products: {} })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("useProductVariables", () => {
  it("prices the paywall's Stripe products inside the Web SDK", async () => {
    window.history.replaceState(null, "", `/?client_surface=web-sdk${hashOf(init)}`);
    const fetch = stubVariables();
    const { result } = render();
    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.getSnapshot().productsByReference.primary).toMatchObject({
      productId: "test:price_1:no-trial",
      variables,
    });
  });

  it("leaves pricing to an SDK that hosts the paywall", async () => {
    window.history.replaceState(
      null,
      "",
      `/?client_surface=web-sdk${hashOf({ ...init, hostsFrameworkPaywalls: true })}`,
    );
    const fetch = stubVariables();
    render();
    await flush();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves a native host's products alone", async () => {
    const fetch = stubVariables();
    render({ products: [], device: { platform: "iOS" } });
    await flush();

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the product variables cache", () => {
  it("shows the last answer first, then the live one, and keeps the live one", async () => {
    window.history.replaceState(null, "", `/?client_surface=web-sdk${hashOf(init)}`);
    const key = `sw:product-variables:${init.apiBase}|primary=test:price_1:no-trial`;
    localStorage.setItem(
      key,
      JSON.stringify({
        at: Date.now(),
        products: [
          {
            reference: "primary",
            productId: "test:price_1:no-trial",
            variables: { price: "$39.99" },
          },
        ],
      }),
    );
    let answer: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );

    const { result } = render();
    await flush();
    expect(result.current.getSnapshot().productsByReference.primary?.variables).toEqual({
      price: "$39.99",
    });

    answer(Response.json({ products: { "stripe|test:price_1:no-trial": variables } }));
    await flush();
    await flush();
    expect(result.current.getSnapshot().productsByReference.primary?.variables).toEqual(variables);
    expect(readCachedProductVariables(key)?.[0]?.variables).toEqual(variables);
  });

  it("ignores an answer older than a day", () => {
    const key = "sw:product-variables:old";
    localStorage.setItem(key, JSON.stringify({ at: 0, products: [] }));
    expect(readCachedProductVariables(key, 24 * 60 * 60 * 1000 + 1)).toBeNull();
  });
});
