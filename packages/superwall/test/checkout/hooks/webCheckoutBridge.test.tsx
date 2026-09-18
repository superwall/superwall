import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useWebCheckoutBridge } from "../../../src/checkout/hooks/useWebCheckoutBridge";
import { completedWebCheckout } from "../../../src/checkout/redemption";

const Bridge = () => {
  useWebCheckoutBridge();
  return null;
};

type Holder = typeof window & {
  __sw_runtime_controller?: Record<string, unknown>;
};

afterEach(() => {
  completedWebCheckout.set(undefined);
  delete (window as Holder).__sw_runtime_controller;
});

describe("useWebCheckoutBridge", () => {
  it("records what the host hands back through completeWebCheckout, and restores on unmount", () => {
    const view = render(<Bridge />);
    const holder = window as Holder;

    const complete = holder.__sw_runtime_controller?.completeWebCheckout as (
      input: unknown,
    ) => void;
    complete({
      redemptionUrl: "https://redeem.example.com/abc",
      postCheckoutRequestUrl: "https://api.example.com/post",
    });

    expect(completedWebCheckout.get()).toMatchObject({
      redemptionUrl: "https://redeem.example.com/abc",
      postCheckoutRequestUrl: "https://api.example.com/post",
    });

    view.unmount();
    expect(holder.__sw_runtime_controller).toBeUndefined();
  });

  it("preserves an existing controller and its other methods", () => {
    const holder = window as Holder;
    const existing = { somethingElse: () => "kept" };
    holder.__sw_runtime_controller = existing;

    const view = render(<Bridge />);
    const controller = holder.__sw_runtime_controller as {
      completeWebCheckout?: unknown;
      somethingElse: () => string;
    };
    expect(typeof controller.completeWebCheckout).toBe("function");
    expect(controller.somethingElse()).toBe("kept");

    view.unmount();
    expect(holder.__sw_runtime_controller).toBe(existing);
  });
});
