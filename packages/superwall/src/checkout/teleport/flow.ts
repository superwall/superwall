import { hostOf } from "../../host";
import { createAppTeleporter } from "./app";
import { readTeleportBoot } from "./boot";
import { createTeleportPage } from "./page";
import { createStudioTeleporter } from "./studio";
import type { Teleporter, TeleportSession } from "./teleporter";

const teleporters = new WeakMap<object, Teleporter>();

export const teleportFor = (paywall: TeleportSession): Teleporter => {
  const existing = teleporters.get(paywall);
  if (existing) return existing;
  const boot = readTeleportBoot();
  const created =
    boot !== undefined
      ? createTeleportPage(paywall, boot)
      : hostOf() === "studio"
        ? createStudioTeleporter(paywall)
        : createAppTeleporter(paywall);
  teleporters.set(paywall, created);
  return created;
};
