import { createAppTeleporter } from "./app";
import { readTeleportBoot } from "./boot";
import { createTeleportPage } from "./page";
import type { Teleporter, TeleportSession } from "./teleporter";

const teleporters = new WeakMap<object, Teleporter>();

export const teleportFor = (paywall: TeleportSession): Teleporter => {
  const existing = teleporters.get(paywall);
  if (existing) return existing;
  const boot = readTeleportBoot();
  const created =
    boot === undefined ? createAppTeleporter(paywall) : createTeleportPage(paywall, boot);
  teleporters.set(paywall, created);
  return created;
};
