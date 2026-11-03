import type { DiagnosticStage } from "./host";

export type EmbeddedStage = Extract<
  DiagnosticStage,
  "stripe_js_loaded" | "embedded_mounted" | "checkout_rendered" | "stripe_error"
>;

type StageRecord = { stage: EmbeddedStage; at: number; error?: string };

export type DiagnosticReport = (stage: DiagnosticStage, ms: number, error?: string) => void;

const SESSIONS_KEPT = 20;
const RECORDS_PER_SESSION = 20;
const ERROR_LENGTH = 500;
export const DIAGNOSTIC_WINDOW = 60_000;

const textOf = (error: unknown): string => {
  try {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return typeof error === "string" ? error : String(error);
  } catch {
    return "Unreadable error";
  }
};

const messageOf = (error: unknown): string => textOf(error).slice(0, ERROR_LENGTH);

const safely = (run: () => void) => {
  try {
    run();
  } catch (error) {
    console.error("[checkout] reporting a checkout diagnostic failed:", error);
  }
};

export type DiagnosticTracker = { timedOut: () => void; stop: () => void };

export const createCheckoutDiagnostics = (now: () => number = () => Date.now()) => {
  const records = new Map<string, StageRecord[]>();
  const listeners = new Set<(clientSecret: string, record: StageRecord) => void>();
  const trackers = new Map<string, () => void>();

  const record = (clientSecret: string, stage: EmbeddedStage, error?: unknown): void => {
    const entry: StageRecord = {
      stage,
      at: now(),
      ...(error === undefined ? {} : { error: messageOf(error) }),
    };
    const kept = records.get(clientSecret) ?? [];
    records.delete(clientSecret);
    records.set(clientSecret, [...kept, entry].slice(-RECORDS_PER_SESSION));
    for (const oldest of records.keys()) {
      if (records.size <= SESSIONS_KEPT) break;
      records.delete(oldest);
    }
    for (const listener of listeners) safely(() => listener(clientSecret, entry));
  };

  const track = (
    clientSecret: string,
    tappedAt: number,
    report: DiagnosticReport,
  ): DiagnosticTracker => {
    trackers.get(clientSecret)?.();
    const posted = new Set<StageRecord>();
    let active = true;

    const stop = () => {
      if (!active) return;
      active = false;
      clearTimeout(deadline);
      listeners.delete(listener);
      if (trackers.get(clientSecret) === stop) trackers.delete(clientSecret);
    };

    const post = (entry: StageRecord) => {
      if (!active || posted.has(entry)) return;
      posted.add(entry);
      safely(() => report(entry.stage, entry.at - tappedAt, entry.error));
      if (entry.stage === "checkout_rendered") stop();
    };

    const listener = (secret: string, entry: StageRecord) => {
      if (secret === clientSecret) post(entry);
    };

    const deadline = setTimeout(stop, DIAGNOSTIC_WINDOW);
    trackers.set(clientSecret, stop);
    listeners.add(listener);
    safely(() => report("tap", 0));
    safely(() => report("session_ready", now() - tappedAt));
    for (const entry of records.get(clientSecret) ?? []) post(entry);

    return {
      timedOut: () => {
        if (active) safely(() => report("ready_timeout", now() - tappedAt));
      },
      stop,
    };
  };

  return { record, track };
};

export const checkoutDiagnostics = createCheckoutDiagnostics();
