import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePurchase, useSuperwallSnapshot } from "../../src/hooks";
import { renderToString } from "react-dom/server";
import { SuperwallProvider } from "../../src";
import { flush, renderWithProvider, testConfig } from "../helpers";

const recorder = () => {
  const calls: unknown[][] = [];
  const callbacks = {
    onStart: (product: { reference: string }) => calls.push(["start", product.reference]),
    onSubmit: (product: { reference: string }) => calls.push(["submit", product.reference]),
    onComplete: (product: { reference: string }) => calls.push(["complete", product.reference]),
    onAbandon: (product: { reference: string }) => calls.push(["abandon", product.reference]),
    onFailure: (failure: { reason: string; product: { reference: string } }) =>
      calls.push(["failure", failure.reason, failure.product.reference]),
  };
  return { calls, callbacks };
};

describe("usePurchase when the SDK reports a failure", () => {
  it("resolves as failed with the sdk reason, and clears the pending state", async () => {
    const { result } = renderWithProvider(() => usePurchase(), { host: { purchase: "failed" } });
    await flush();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase("primary");
    });

    expect(outcome).toMatchObject({ status: "failed", reason: "unknown" });
    expect(result.current.isPurchasing).toBe(false);
    expect(result.current.failure?.reason).toBe("unknown");
    expect(result.current.transaction).toBeUndefined();
  });

  it("hands a Stripe product to the host when the page has no API key", async () => {
    const { result } = renderWithProvider(() => usePurchase(), {
      config: { checkout: "sheet", products: { primary: "test:price_1:no-trial" } },
      host: {
        products: [{ reference: "primary", productId: "test:price_1:no-trial" }],
        purchase: "abandoned",
      },
    });
    await flush();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.purchase("primary");
    });

    expect(outcome).toMatchObject({ status: "abandoned" });
  });
});

describe("purchase callbacks for a store purchase made by the SDK", () => {
  it.each([
    ["completed", ["complete", "primary"]],
    ["abandoned", ["abandon", "primary"]],
    ["failed", ["failure", "unknown", "primary"]],
  ] as const)("fires start, then the end of a %s purchase, on every hook", async (ending, last) => {
    const watcher = recorder();
    const { result } = renderWithProvider(
      () => ({ buyer: usePurchase(), watcher: usePurchase(watcher.callbacks) }),
      { host: { purchase: ending } },
    );
    await flush();

    await act(async () => {
      await result.current.buyer.purchase("primary");
    });

    expect(watcher.calls).toEqual([["start", "primary"], last]);
  });

  it("fires a purchase() call's own callbacks for that call only", async () => {
    const own = recorder();
    const { result } = renderWithProvider(() => usePurchase(), { host: { purchase: "failed" } });
    await flush();

    await act(async () => {
      await result.current.purchase("primary", own.callbacks);
    });
    await act(async () => {
      await result.current.purchase("primary");
    });

    expect(own.calls).toEqual([
      ["start", "primary"],
      ["failure", "unknown", "primary"],
    ]);
  });
});

describe("purchase() of a product the paywall's catalog doesn't hold", () => {
  it("still fires the callbacks, with that product", async () => {
    const own = recorder();
    const watcher = recorder();
    const { result } = renderWithProvider(
      () => ({
        buyer: usePurchase(watcher.callbacks),
        primary: useSuperwallSnapshot().productsByReference.primary,
      }),
      { host: { purchase: "completed" } },
    );
    await flush();
    const primary = result.current.primary;
    if (!primary) throw new Error("expected the primary product");
    const inline = { ...primary, reference: "inline", productId: "com.example.inline" };

    await act(async () => {
      await result.current.buyer.purchase(inline, own.callbacks);
    });

    expect(own.calls).toEqual([
      ["start", "inline"],
      ["complete", "inline"],
    ]);
    expect(watcher.calls).toEqual(own.calls);
  });
});

describe("purchase() callbacks when two purchases overlap", () => {
  it("fires each call's callbacks for its own purchase only", async () => {
    const { result } = renderWithProvider(() => usePurchase(), { host: { purchase: "completed" } });
    await flush();
    const calls: string[] = [];
    const record = (call: string) => ({
      onStart: (product: { reference: string }) => calls.push(`${call} start ${product.reference}`),
      onComplete: (product: { reference: string }) =>
        calls.push(`${call} complete ${product.reference}`),
      onFailure: (failure: { product: { reference: string } }) =>
        calls.push(`${call} failure ${failure.product.reference}`),
    });

    await act(async () => {
      await Promise.all([
        result.current.purchase("primary", record("a")),
        result.current.purchase("secondary", record("b")),
      ]);
    });

    expect(calls.filter((call) => call.startsWith("a "))).not.toContainEqual(
      expect.stringContaining("secondary"),
    );
    expect(calls.filter((call) => call.startsWith("b "))).not.toContainEqual(
      expect.stringContaining("primary"),
    );
    expect(calls).toContain("a start primary");
    expect(calls).toContain("b start secondary");
  });
});

describe("usePurchase rendered on the server", () => {
  it("renders, as a teleport page's prerender does", () => {
    const Probe = () => {
      const { failure } = usePurchase();
      return <p>{failure ? failure.reason : "none"}</p>;
    };
    const html = renderToString(
      <SuperwallProvider config={testConfig}>
        <Probe />
      </SuperwallProvider>,
    );
    expect(html).toContain("none");
  });
});
