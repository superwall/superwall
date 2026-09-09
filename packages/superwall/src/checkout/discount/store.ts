import { bareProductIdentifier } from "../products";
import type { AppliedDiscount, DiscountedProductPrice } from "../types";

/** A promotion code the backend validated, and what it does to each product. */
export type AppliedDiscountState = {
  code: string;
  discount: AppliedDiscount;
  products: DiscountedProductPrice[];
};

export type DiscountStore = {
  readonly applied: AppliedDiscountState | null;
  subscribe(listener: () => void): () => void;
  subscribeDropped(listener: (code: string) => void): () => void;
  codeFor(productIdentifier: string): string | null;
  apply(code: string, discount: AppliedDiscount, products: DiscountedProductPrice[]): void;
  clear(): boolean;
  drop(code: string): void;
};

export const createDiscountStore = (): DiscountStore => {
  let applied: AppliedDiscountState | null = null;
  let applicable: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const droppedListeners = new Set<(code: string) => void>();

  const notify = () => listeners.forEach((listener) => listener());

  const forget = () => {
    applied = null;
    applicable = new Set();
    notify();
  };

  return {
    get applied() {
      return applied;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeDropped: (listener) => {
      droppedListeners.add(listener);
      return () => {
        droppedListeners.delete(listener);
      };
    },
    codeFor: (productIdentifier) =>
      applied && applicable.has(bareProductIdentifier(productIdentifier)) ? applied.code : null,
    apply: (code, discount, products) => {
      applied = { code, discount, products };
      applicable = new Set(
        products
          .filter((product) => product.applies)
          .map((product) => bareProductIdentifier(product.productIdentifier)),
      );
      notify();
    },
    clear: () => {
      if (!applied) return false;
      forget();
      return true;
    },
    drop: (code) => {
      forget();
      droppedListeners.forEach((listener) => listener(code));
    },
  };
};
