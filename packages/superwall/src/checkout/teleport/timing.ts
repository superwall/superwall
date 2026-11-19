import { checkoutEvents } from "../events";
import { readTeleportBoot } from "./boot";

export const TELEPORT_MARKS = {
  scriptStart: "superwall:teleport:script-start",
  firstPaint: "superwall:teleport:first-paint",
  firstRender: "superwall:teleport:first-render",
  paymentReady: "superwall:teleport:payment-ready",
} as const;

export type TeleportMark = (typeof TELEPORT_MARKS)[keyof typeof TELEPORT_MARKS];

export const markTeleportPage = (mark: TeleportMark): void => {
  if (readTeleportBoot() === undefined) return;
  try {
    if (performance.getEntriesByName(mark, "mark").length > 0) return;
    performance.mark(mark);
  } catch {}
};

export const PAINT_FALLBACK_MS = 100;

export const afterPaint = (callback: () => void): (() => void) => {
  let pending = true;
  let frame: number | undefined;
  let task: ReturnType<typeof setTimeout> | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    pending = false;
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(task);
    clearTimeout(fallback);
  };
  const run = () => {
    if (!pending) return;
    stop();
    callback();
  };
  fallback = setTimeout(run, PAINT_FALLBACK_MS);
  if (typeof requestAnimationFrame === "function") {
    frame = requestAnimationFrame(() => {
      frame = undefined;
      task = setTimeout(run, 0);
    });
  }
  return stop;
};

export const markTeleportScriptStart = (): void => markTeleportPage(TELEPORT_MARKS.scriptStart);

export const watchTeleportPageTiming = (): (() => void) => {
  markTeleportPage(TELEPORT_MARKS.firstRender);
  return checkoutEvents.subscribe("EMBEDDED_READY", () =>
    markTeleportPage(TELEPORT_MARKS.paymentReady),
  );
};
