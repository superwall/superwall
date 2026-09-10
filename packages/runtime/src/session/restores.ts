import type { SuperwallRestoreResult } from "./types";

export type RestoreTracker = {
  begin: () => Promise<SuperwallRestoreResult>;
  settle: (status: SuperwallRestoreResult["status"]) => void;
};

export const createRestoreTracker = (): RestoreTracker => {
  let resolve: ((result: SuperwallRestoreResult) => void) | undefined;
  let pending: Promise<SuperwallRestoreResult> | undefined;

  return {
    begin: () => {
      if (pending) return pending;
      pending = new Promise((settle) => {
        resolve = settle;
      });
      return pending;
    },
    settle: (status) => {
      const settled = resolve;
      resolve = undefined;
      pending = undefined;
      settled?.({ status });
    },
  };
};
