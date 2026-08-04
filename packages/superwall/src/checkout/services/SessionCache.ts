import { SESSION_CACHE_TTL } from "../utils/constants";
import type { CheckoutSessionResult, CheckoutSessionCacheScope } from "../state/types";

type CacheEntry = {
  session: CheckoutSessionResult;
  createdAt: number;
};

const keyFor = (referenceName: string, scope: CheckoutSessionCacheScope) =>
  `${scope}:${referenceName}`;

class SessionCache {
  private cache = new Map<string, CacheEntry>();

  get(
    referenceName: string,
    scope: CheckoutSessionCacheScope = "default",
  ): CheckoutSessionResult | null {
    const entry = this.cache.get(keyFor(referenceName, scope));
    if (!entry) return null;

    if (Date.now() - entry.createdAt > SESSION_CACHE_TTL) {
      this.cache.delete(keyFor(referenceName, scope));
      return null;
    }

    return entry.session;
  }

  set(
    referenceName: string,
    session: CheckoutSessionResult,
    scope: CheckoutSessionCacheScope = "default",
  ): void {
    this.cache.set(keyFor(referenceName, scope), { session, createdAt: Date.now() });
  }

  cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > SESSION_CACHE_TTL) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const sessionCache = new SessionCache();
