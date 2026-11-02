import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionCache } from "../../../src/checkout/session/cache";
import { SESSION_CACHE_TTL } from "../../../src/checkout/session/cache";
import type { RedirectCheckoutSession } from "../../../src/checkout/types";

afterEach(() => {
  vi.useRealTimers();
});

describe("the checkout session cache", () => {
  const sessionCache = createSessionCache();

  const session: RedirectCheckoutSession = {
    directive: "redirect",
    checkoutSessionId: "cs",
    checkoutUrl: "https://x",
    checkoutContextId: "ctx",
    referenceName: "monthly",
  };

  it("keys a session by its prepaid-card rule, allowing by default", () => {
    const cache = createSessionCache();
    cache.set("monthly", session, "default", "block");
    expect(cache.get("monthly")).toBeNull();
    expect(cache.get("monthly", "default", "block")).toEqual(session);
    cache.set("monthly", session);
    expect(cache.get("monthly", "default", "allow")).toEqual(session);
  });

  it("forgets a session once its TTL has passed", () => {
    vi.useFakeTimers();
    sessionCache.set("monthly", session);
    expect(sessionCache.get("monthly")).toEqual(session);

    vi.advanceTimersByTime(SESSION_CACHE_TTL + 1);
    expect(sessionCache.get("monthly")).toBeNull();
  });

  it("sweeps expired entries and keeps fresh ones", () => {
    vi.useFakeTimers();
    sessionCache.set("old", session);
    vi.advanceTimersByTime(SESSION_CACHE_TTL + 1);
    sessionCache.set("fresh", session, "apple-pay");

    sessionCache.cleanupExpired();

    expect(sessionCache.get("fresh", "apple-pay")).toEqual(session);
    vi.advanceTimersByTime(1);
    expect(sessionCache.get("old")).toBeNull();
  });
});
