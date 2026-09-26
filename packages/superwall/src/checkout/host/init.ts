import { decodeBase64Utf8 } from "@superwall/runtime";
import { asString, field } from "../api/decode";

export type WebSdkPlacement = { name: string; eventId: string };

export const webSdkPlacement = (hash: string = window.location.hash): WebSdkPlacement => {
  if (!hash.startsWith("#init=")) return { name: "", eventId: "" };
  try {
    const payload: unknown = JSON.parse(decodeBase64Utf8(hash.slice("#init=".length)));
    const presentment = field(field(payload, "checkoutContext"), "presentment");
    return {
      name: asString(field(presentment, "presentedByEventName")),
      eventId: asString(field(presentment, "presentedByEventId")),
    };
  } catch {
    return { name: "", eventId: "" };
  }
};

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

export const presentingPlacement = (params: Record<string, unknown>): WebSdkPlacement => {
  const web = webSdkPlacement();
  return {
    name: textOf(params.event_name) || web.name,
    eventId: asString(params.event_id) || web.eventId,
  };
};
