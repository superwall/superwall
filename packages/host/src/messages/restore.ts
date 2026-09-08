import type {
  TIncomingMessageRestoreComplete,
  TIncomingMessageRestoreFail,
  TIncomingMessageRestoreStart,
} from "@superwall/protocol";

export const restoreStart = (): TIncomingMessageRestoreStart => ({ event_name: "restore_start" });

export const restoreComplete = (): TIncomingMessageRestoreComplete => ({
  event_name: "restore_complete",
});

export const restoreFail = (): TIncomingMessageRestoreFail => ({ event_name: "restore_fail" });
