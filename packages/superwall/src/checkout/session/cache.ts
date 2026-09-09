import type { CheckoutSessionResult, SessionScope } from "../types";

export const SESSION_CACHE_TTL = 10 * 60 * 1000;

export type SessionCache = {
  get(referenceName: string, scope?: SessionScope): CheckoutSessionResult | null;
  set(referenceName: string, session: CheckoutSessionResult, scope?: SessionScope): void;
  cleanupExpired(): void;
  clear(): void;
};

type Entry = { session: CheckoutSessionResult; createdAt: number };

const keyFor = (referenceName: string, scope: SessionScope) => `${scope}:${referenceName}`;

const expired = (entry: Entry) => Date.now() - entry.createdAt > SESSION_CACHE_TTL;

export const createSessionCache = (): SessionCache => {
  const entries = new Map<string, Entry>();

  return {
    get: (referenceName, scope = "default") => {
      const key = keyFor(referenceName, scope);
      const entry = entries.get(key);
      if (!entry) return null;
      if (expired(entry)) {
        entries.delete(key);
        return null;
      }
      return entry.session;
    },
    set: (referenceName, session, scope = "default") => {
      entries.set(keyFor(referenceName, scope), { session, createdAt: Date.now() });
    },
    cleanupExpired: () => {
      for (const [key, entry] of entries) {
        if (expired(entry)) entries.delete(key);
      }
    },
    clear: () => entries.clear(),
  };
};
