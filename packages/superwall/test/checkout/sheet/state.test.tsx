import { act, render, renderHook } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { SheetProvider, useSheetActions, useSheetState } from "../../../src/checkout/sheet/state";
import { checkoutEvents } from "../../../src/checkout/events";
import { openEmbeddedSheet } from "../../../src/checkout/flow";
import { embeddedCheckouts } from "../../../src/checkout/sheet/embedded";
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

  it("keeps the warm session when another plan is prepared, and swaps on a tap", () => {
    const { result } = mount();

    act(() => {
      checkoutEvents.dispatch("SESSION_PREFETCHED", sessionFor("a"));
      checkoutEvents.dispatch("SESSION_PREFETCHED", {
        ...sessionFor("b"),
        referenceName: "weekly",
      });
    });
    expect([...result.current.state.pooledSessions.keys()]).toEqual(["a"]);

    act(() =>
      checkoutEvents.dispatch("SESSION_CREATED", { ...sessionFor("b"), referenceName: "weekly" }),
    );
    expect([...result.current.state.pooledSessions.keys()]).toEqual(["b"]);
  });

  it("opens at once on the tap after a timeout, once Stripe finished in the background", async () => {
    vi.useFakeTimers();
    const opened = vi.fn();
    const stop = checkoutEvents.subscribe("SHEET_OPEN", opened);
    const { result } = mount();

    let first: ReturnType<typeof openEmbeddedSheet> | undefined;
    act(() => {
      first = openEmbeddedSheet(sessionFor("a"));
    });
    act(() => vi.advanceTimersByTime(10_000));
    await expect(first).resolves.toEqual({ status: "failed" });
    expect(opened).not.toHaveBeenCalled();
    expect([...result.current.state.pooledSessions.keys()]).toEqual(["a"]);

    act(() => checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: "a" }));
    act(() => {
      void openEmbeddedSheet(sessionFor("a"));
    });

    expect(opened).toHaveBeenCalledOnce();
    expect(result.current.state.isOpen).toBe(true);
    stop();
    act(() => checkoutEvents.dispatch("SHEET_CLOSE", undefined));
    vi.useRealTimers();
  });

  it("asks Stripe to start again on a tap whose session is not ready, and not once it is", () => {
    const retry = vi.spyOn(embeddedCheckouts, "retry").mockImplementation(() => {});
    mount();

    act(() => checkoutEvents.dispatch("SESSION_CREATED", sessionFor("a")));
    expect(retry).toHaveBeenCalledWith("a");

    act(() => checkoutEvents.dispatch("EMBEDDED_READY", { clientSecret: "a" }));
    retry.mockClear();
    act(() => checkoutEvents.dispatch("SESSION_CREATED", sessionFor("a")));
    expect(retry).not.toHaveBeenCalled();
    retry.mockRestore();
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
