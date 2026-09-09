import { act, render, renderHook } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { SheetProvider, useSheetActions, useSheetState } from "../../../src/checkout/sheet/state";
import { checkoutEvents } from "../../../src/checkout/events";
import type { EmbeddedCheckoutSession } from "../../../src/checkout/types";

const sessionFor = (clientSecret: string): EmbeddedCheckoutSession => ({
  directive: "embedded",
  clientSecret,
  publishableKey: "pk_test",
  checkoutContextId: `ctx_${clientSecret}`,
  checkoutSessionId: `sw_checkout_${clientSecret}`,
  referenceName: "annual",
});

const Bare = () => {
  useSheetState();
  return null;
};

const BareActions = () => {
  useSheetActions();
  return null;
};

const mount = () =>
  renderHook(() => ({ state: useSheetState(), actions: useSheetActions() }), {
    wrapper: ({ children }: React.PropsWithChildren) => <SheetProvider>{children}</SheetProvider>,
  });

describe("SheetProvider", () => {
  it("pools a created session and opens the sheet when one is asked for", () => {
    const { result } = mount();

    act(() => checkoutEvents.dispatch("SESSION_CREATED", sessionFor("a")));
    expect([...result.current.state.pooledSessions.keys()]).toEqual(["a"]);
    expect(result.current.state.isOpen).toBe(false);

    act(() => checkoutEvents.dispatch("SHEET_OPEN", { session: sessionFor("a") }));
    expect(result.current.state.isOpen).toBe(true);
    expect(result.current.state.activeSession?.clientSecret).toBe("a");

    act(() => checkoutEvents.dispatch("SHEET_CLOSE", undefined));
    expect(result.current.state.isOpen).toBe(false);
  });

  it("replays readiness for a session Stripe already rendered, so a reopen is instant", () => {
    const { result } = mount();
    const ready = vi.fn();

    act(() => {
      checkoutEvents.dispatch("SESSION_CREATED", sessionFor("a"));
      checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: "a" });
    });
    expect(result.current.state.readyState.has("a")).toBe(true);

    const stop = checkoutEvents.subscribe("EMBEDDED_READY", ready);
    act(() => checkoutEvents.dispatch("SESSION_CREATED", sessionFor("a")));
    stop();

    expect(ready).toHaveBeenCalledWith({ clientSecret: "a" });
  });

  it("records a payment error and forgets the pool when sessions are invalidated", () => {
    const { result } = mount();
    const failure = new Error("card declined");

    act(() => {
      checkoutEvents.dispatch("SESSION_CREATED", sessionFor("a"));
      checkoutEvents.dispatch("PAYMENT_ERROR", { error: failure, session: sessionFor("a") });
    });
    expect(result.current.state.error).toBe(failure);

    act(() => checkoutEvents.dispatch("SESSION_INVALIDATED", { reason: "code redeemed" }));
    expect(result.current.state.pooledSessions.size).toBe(0);
  });

  it("stops listening once it unmounts, so a stray event cannot touch it", () => {
    const view = mount();
    view.unmount();
    expect(() => checkoutEvents.dispatch("SHEET_CLOSE", undefined)).not.toThrow();
  });

  it("refuses to be used outside itself", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<Bare />)).toThrow("useSheetState must be used within SheetProvider");
    expect(() => render(<BareActions />)).toThrow(
      "useSheetActions must be used within SheetProvider",
    );
    error.mockRestore();
  });
});
