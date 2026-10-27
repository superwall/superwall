import { teleportFor } from "../../../src/checkout/teleport/flow";
import type {
  AppTeleport,
  TeleportPage,
  TeleportSession,
} from "../../../src/checkout/teleport/teleporter";

export const appTeleport = (session: TeleportSession): AppTeleport => {
  const teleporter = teleportFor(session);
  if (teleporter.kind !== "app") throw new Error("Expected the app half of the teleport.");
  return teleporter;
};

export const teleportPage = (session: TeleportSession): TeleportPage => {
  const teleporter = teleportFor(session);
  if (teleporter.kind !== "page") throw new Error("Expected the teleport's web page.");
  return teleporter;
};
