import { describe, expect, it } from "vitest";
import { checkoutReducer, initialCheckoutState } from "../../src/checkout/state/CheckoutStore";
import type { CheckoutAction, CheckoutState, SessionData } from "../../src/checkout/state/types";

const sessionFor = (clientSecret: string): SessionData => ({
  directive: "embedded",
  clientSecret,
  publishableKey: "pk_test_123",
  checkoutContextId: `ctx_${clientSecret}`,
  checkoutSessionId: `sw_checkout_${clientSecret}`,
  referenceName: "annual",
});

const reduce = (state: CheckoutState, ...actions: CheckoutAction[]): CheckoutState =>
  actions.reduce(checkoutReducer, state);

describe("the checkout session pool", () => {
  it("keeps only one embedded session — a second replaces the first", () => {
    const state = reduce(
      initialCheckoutState,
      { type: "ADD_SESSION", payload: sessionFor("a") },
      { type: "ADD_SESSION", payload: sessionFor("b") },
    );

    expect([...state.pooledSessions.keys()]).toEqual(["b"]);
    expect(state.readyState.has("a")).toBe(false);
  });

  it("re-adding the same session updates it in place rather than duplicating", () => {
    const state = reduce(
      initialCheckoutState,
      { type: "ADD_SESSION", payload: sessionFor("a") },
      { type: "ADD_SESSION", payload: { ...sessionFor("a"), referenceName: "monthly" } },
    );

    expect(state.poolOrder).toEqual(["a"]);
    expect(state.pooledSessions.get("a")?.referenceName).toBe("monthly");
  });

  it("forgets a session's readiness when it is removed, so a reopen re-waits", () => {
    const state = reduce(
      initialCheckoutState,
      { type: "ADD_SESSION", payload: sessionFor("a") },
      { type: "MARK_READY", payload: "a" },
    );
    expect(state.readyState.get("a")).toBe(true);

    const after = reduce(state, { type: "REMOVE_SESSION", payload: "a" });
    expect(after.pooledSessions.has("a")).toBe(false);
    expect(after.readyState.has("a")).toBe(false);
  });
});

describe("closing the sheet", () => {
  it("clears the active session so the next open starts a fresh checkout", () => {
    const opened = reduce(
      initialCheckoutState,
      { type: "ADD_SESSION", payload: sessionFor("a") },
      { type: "OPEN_SHEET", payload: sessionFor("a") },
    );
    expect(opened.isOpen).toBe(true);
    expect(opened.activeSession?.clientSecret).toBe("a");

    const closed = reduce(opened, { type: "CLOSE_SHEET" });
    expect(closed.isOpen).toBe(false);
    expect(closed.activeSession).toBeNull();
  });

  it("drops the processing lock, so a reopened sheet is not stuck shut", () => {
    const stuck = reduce(
      initialCheckoutState,
      { type: "OPEN_SHEET", payload: sessionFor("a") },
      { type: "SET_PROCESSING", payload: true },
    );
    expect(stuck.isProcessing).toBe(true);

    expect(reduce(stuck, { type: "CLOSE_SHEET" }).isProcessing).toBe(false);
  });

  it("clears a previous error, so a stale failure cannot haunt the next attempt", () => {
    const failed = reduce(initialCheckoutState, {
      type: "SET_ERROR",
      payload: new Error("card declined"),
    });
    expect(failed.error).not.toBeNull();

    expect(reduce(failed, { type: "CLOSE_SHEET" }).error).toBeNull();
  });
});

describe("invalidating sessions", () => {
  it("empties the pool when nobody is mid-checkout", () => {
    const state = reduce(
      initialCheckoutState,
      { type: "ADD_SESSION", payload: sessionFor("a") },
      { type: "CLEAR_ALL_SESSIONS" },
    );

    expect(state.pooledSessions.size).toBe(0);
    expect(state.poolOrder).toEqual([]);
    expect(state.readyState.size).toBe(0);
  });

  it("spares the session being paid with — pulling it would break an open checkout", () => {
    const state = reduce(
      initialCheckoutState,
      { type: "ADD_SESSION", payload: sessionFor("a") },
      { type: "OPEN_SHEET", payload: sessionFor("a") },
      { type: "MARK_READY", payload: "a" },
      { type: "CLEAR_ALL_SESSIONS" },
    );

    expect([...state.pooledSessions.keys()]).toEqual(["a"]);
    expect(state.poolOrder).toEqual(["a"]);
    expect(state.readyState.get("a")).toBe(true);
  });
});
