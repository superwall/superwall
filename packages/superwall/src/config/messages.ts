import type { SuperwallMessages } from "@superwall/runtime";
import type { DiscoveredSurface, Project } from "../discover";
import type { PaywallDefinition } from "./paywall";

export const mergeMessages = (
  base: SuperwallMessages | undefined,
  overlay: SuperwallMessages | undefined,
): SuperwallMessages => {
  const merged: Record<string, string | SuperwallMessages> = { ...base };
  for (const [key, value] of Object.entries(overlay ?? {})) {
    const existing = merged[key];
    merged[key] =
      typeof value === "object" && typeof existing === "object"
        ? mergeMessages(existing, value)
        : value;
  }
  return merged;
};

export const localesOf = (
  project: Pick<Project, "sharedMessages">,
  surface: Pick<DiscoveredSurface, "messages">,
  definition: PaywallDefinition | undefined,
): string[] => {
  const locales = new Set<string>();
  for (const entry of [...project.sharedMessages, ...surface.messages]) locales.add(entry.locale);
  for (const locale of Object.keys(definition?.localization?.messages ?? {})) locales.add(locale);
  return [...locales].toSorted();
};
