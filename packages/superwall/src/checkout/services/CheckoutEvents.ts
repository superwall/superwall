import type { CheckoutEventType, CheckoutEventPayload } from "../state/types";

class CheckoutEvents {
  private listeners = new Map<CheckoutEventType, Set<(payload: any) => void>>();

  subscribe<T extends CheckoutEventType>(
    event: T,
    callback: (payload: CheckoutEventPayload[T]) => void,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  dispatch<T extends CheckoutEventType>(event: T, payload: CheckoutEventPayload[T]): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;

    callbacks.forEach((cb) => {
      try {
        cb(payload);
      } catch (error) {
        console.error(`[EventBus] Error in ${event} handler:`, error);
      }
    });
  }
}

export const checkoutEvents = new CheckoutEvents();
