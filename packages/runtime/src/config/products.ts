import type { SuperwallPlatform } from "./platforms";

/**
 * A product slot the paywall renders, keyed by reference in
 * `SuperwallConfig["products"]`. Product data (price, period, trial…) is
 * host-owned and arrives at runtime.
 */
export type SuperwallProductSlot = {
  /** Store product identifier this slot maps to (e.g. "pro_3999_year"). */
  productId?: string;
};

/**
 * One store identifier per platform the paywall ships to, for a slot whose
 * underlying product differs by store — the same `purchase("annual")` buys
 * the App Store product on iOS and the Play product on Android.
 */
export type SuperwallPlatformProductIds = Partial<Record<SuperwallPlatform, string>>;

/**
 * A slot object, the store product identifier as shorthand, or one
 * identifier per platform.
 */
export type SuperwallProductSlotInput = string | SuperwallProductSlot | SuperwallPlatformProductIds;

export const isPlatformProductIds = (
  input: SuperwallProductSlotInput,
): input is SuperwallPlatformProductIds =>
  typeof input === "object" && input !== null && !("productId" in input);

export const productIdFor = (
  input: SuperwallProductSlotInput,
  platform?: SuperwallPlatform,
): string | undefined => {
  if (typeof input === "string") return input;
  if (!isPlatformProductIds(input)) return input.productId;
  if (platform !== undefined) return input[platform];
  return Object.values(input).find((id) => typeof id === "string");
};
