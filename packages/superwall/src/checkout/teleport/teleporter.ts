import type { SuperwallPostPurchase, SuperwallSession } from "@superwall/runtime";
import type { PurchaseOutcome } from "../types";
import { NAV_QUERY_KEY } from "./boot";

export type TeleportStatus =
  | { status: "idle" }
  | { status: "waiting"; productReference?: string; returned: boolean }
  | { status: "arrived"; productReference?: string }
  | { status: "completed"; productReference?: string; paidElsewhere: boolean };

export type TeleportEvent = "open" | "return" | "cancel" | "complete";

export type HandedOff = { reference: string; result: Promise<{ status: PurchaseOutcome }> };

export type TeleportOutcome = PurchaseOutcome | HandedOff;

export type TeleportRequest = {
  route?: string;
  productReference?: string;
  query: Record<string, string>;
  postPurchase?: SuperwallPostPurchase;
  stripeMetadata?: Readonly<Record<string, string>>;
};

export type ReturnReason = "purchased" | "closed";

type TeleportBase = {
  getStatus(): TeleportStatus;
  subscribe(listener: () => void): () => void;
  on(event: TeleportEvent, handler: () => void): () => void;
  attach(session: AttachedSession): () => void;
};

export type AppTeleport = TeleportBase & {
  kind: "app";
  available(): boolean;
  landed(route: string): void;
  begin(request: TeleportRequest): Promise<TeleportOutcome>;
  prefetch(route?: string, query?: Record<string, string>): void;
  beginPresentation(presentationId?: string): void;
  endPresentation(): void;
  refreshIntroductoryOffer(): void;
  inFlight(): boolean;
  handOff<T extends { status: PurchaseOutcome }>(
    reference: string,
    purchase: () => Promise<T>,
  ): Promise<T>;
  open(): void;
  cancel(): void;
  fallback(): string | undefined;
  showWaitingScreen(): Promise<boolean>;
  handleReturn(reason?: string): Promise<boolean>;
};

export type TeleportPage = TeleportBase & {
  kind: "page";
  whenUnsettled(): Promise<boolean>;
  checkSettled(atBoot?: boolean): Promise<boolean>;
  watchPresentation(): () => void;
  completePurchase(checkoutContextId: string): Promise<void>;
  followFragment(): void;
  returnToApp(reason?: ReturnReason): void;
};

export type Teleporter = AppTeleport | TeleportPage;

export type TeleportSession = Pick<SuperwallSession, "getSnapshot" | "postMessage">;

export type AttachedSession = Pick<
  SuperwallSession,
  "getSnapshot" | "postMessage" | "purchase" | "on"
>;

export const flowQuery = (
  store: { entries(): Record<string, string> } | null,
): Record<string, string> => {
  const { [NAV_QUERY_KEY]: _nav, ...query } = store?.entries() ?? {};
  return query;
};

export const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

export const createStatusStore = (initial: TeleportStatus) => {
  const listeners = new Set<() => void>();
  const handlers = new Map<TeleportEvent, Set<() => void>>();
  let status = initial;
  return {
    getStatus: () => status,
    setStatus: (next: TeleportStatus) => {
      if (JSON.stringify(next) === JSON.stringify(status)) return;
      status = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    on: (event: TeleportEvent, handler: () => void) => {
      const set = handlers.get(event) ?? new Set<() => void>();
      set.add(handler);
      handlers.set(event, set);
      return () => {
        set.delete(handler);
      };
    },
    emit: (event: TeleportEvent) => {
      for (const handler of handlers.get(event) ?? []) handler();
    },
  };
};
