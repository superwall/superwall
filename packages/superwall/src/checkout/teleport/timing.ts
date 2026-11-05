import { checkoutEvents } from "../events";
import { readTeleportBoot } from "./boot";

export const TELEPORT_MARKS = {
  scriptStart: "superwall:teleport:script-start",
  firstRender: "superwall:teleport:first-render",
  paymentReady: "superwall:teleport:payment-ready",
} as const;

export type TeleportMark = (typeof TELEPORT_MARKS)[keyof typeof TELEPORT_MARKS];

export const markTeleportPage = (mark: TeleportMark): void => {
  if (readTeleportBoot() === undefined) return;
  try {
    if (typeof performance === "undefined") return;
    if (performance.getEntriesByName(mark, "mark").length > 0) return;
    performance.mark(mark);
  } catch {}
};

export const markTeleportScriptStart = (): void => markTeleportPage(TELEPORT_MARKS.scriptStart);

export const watchTeleportPageTiming = (): (() => void) => {
  markTeleportPage(TELEPORT_MARKS.firstRender);
  return checkoutEvents.subscribe("EMBEDDED_READY", () =>
    markTeleportPage(TELEPORT_MARKS.paymentReady),
  );
};
