import type { SuperwallMessages } from "@superwall/runtime";

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
