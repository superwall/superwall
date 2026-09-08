import type { HostDelegate } from "./types";

export const silentDelegate = (): HostDelegate => ({
  event: () => {},
  purchase: () => "completed",
  restore: () => "restored",
  close: () => {},
  openUrl: () => {},
  custom: () => {},
  customPlacement: () => {},
  permission: () => "granted",
  callback: () => ({ status: "success" }),
});
