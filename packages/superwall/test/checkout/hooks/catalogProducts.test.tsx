import { renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuperwallProvider, type SuperwallSession } from "../../../src";
import {
  suppliedProductsFrom,
  useCatalogProducts,
} from "../../../src/checkout/hooks/useCatalogProducts";
import { useSuperwallSession } from "../../../src/hooks";
import { createHost, flush, testConfig, type HostProps } from "../../helpers";

const webConfig = {
  ...testConfig,
  checkout: "sheet" as const,
  products: { primary: "test:price_1:no-trial", native: "pro_3999_year" },
};

const catalog = [
  {
    identifier: "test:price_1:no-trial",
    price: { amount: 4999, currency: "usd" },
    subscription: { period: "year", period_count: 1, trial_period_days: 0 },
  },
];

const webSdkHost: HostProps = {
  products: [],
  device: { publicApiKey: "pk_web", platform: "Web" },
};

const render = (host: HostProps = webSdkHost) => {
  const { transport } = createHost(host);
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <SuperwallProvider config={webConfig} transport={transport}>
      {children}
    </SuperwallProvider>
  );
  return renderHook(
    (): SuperwallSession => {
      useCatalogProducts();
      return useSuperwallSession();
    },
    { wrapper },
  );
};

const stubCatalog = () => {
  const fetch = vi.fn(async (_url: string) => Response.json({ object: "list", data: catalog }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("suppliedProductsFrom", () => {
  it("prices the Stripe slots the paywall declares from the catalog, and nothing else", () => {
    expect(suppliedProductsFrom(webConfig, catalog)).toEqual([
      {
        reference: "primary",
        productId: "test:price_1:no-trial",
        variables: expect.objectContaining({ price: "$49.99", period: "year", periodly: "yearly" }),
      },
    ]);
    expect(suppliedProductsFrom(webConfig, [])).toEqual([]);
  });
});

describe("useCatalogProducts", () => {
  it("prices the paywall's Stripe products inside the Web SDK, which sends none", async () => {
    window.history.replaceState(null, "", "/?client_surface=web-sdk");
    const fetch = stubCatalog();
    const { result } = render();
    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toMatch(/\/products$/);
    expect(result.current.getSnapshot().productsByReference.primary).toMatchObject({
      productId: "test:price_1:no-trial",
      variables: expect.objectContaining({ price: "$49.99" }),
    });
  });

  it("leaves a native host's products alone", async () => {
    const fetch = stubCatalog();
    render({ ...webSdkHost, device: { publicApiKey: "pk_ios", platform: "iOS" } });
    await flush();

    expect(fetch).not.toHaveBeenCalled();
  });
});
