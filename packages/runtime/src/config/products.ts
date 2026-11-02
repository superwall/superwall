import { SUPERWALL_PLATFORMS, type SuperwallPlatform } from "./platforms";

/**
 * How an App Store slot bills a product that offers Apple's monthly plan
 * (a 12-month commitment paid monthly): `"monthly"` sells that plan,
 * `"upFront"` sells the year paid at once.
 */
export type SuperwallBillingPlan = "monthly" | "upFront";

export const SUPERWALL_BILLING_PLANS: readonly SuperwallBillingPlan[] = ["monthly", "upFront"];

/**
 * A product slot the paywall renders, keyed by reference in
 * `SuperwallConfig["products"]`. Product data (price, period, trial…) is
 * host-owned and arrives at runtime.
 */
export type SuperwallProductSlot = {
  /** Store product identifier this slot maps to (e.g. "pro_3999_year"). */
  productId?: string;
  /**
   * Which Apple billing plan this slot sells, when its App Store product
   * offers the monthly plan. iOS only: Android and web have no such plan and
   * ignore it. Defaults to `"monthly"` for a product that offers the monthly
   * plan; has no effect on one that does not.
   */
  billingPlan?: SuperwallBillingPlan;
};

/**
 * One store identifier per platform the paywall ships to, for a slot whose
 * underlying product differs by store — the same `purchase("annual")` buys
 * the App Store product on iOS and the Play product on Android.
 */
export type SuperwallPlatformProductIds = Partial<Record<SuperwallPlatform, string>> & {
  /**
   * Which Apple billing plan the iOS product sells, when it offers the
   * monthly plan. Android and web ignore it. Defaults to `"monthly"` for a
   * product that offers the monthly plan; has no effect on one that does not.
   */
  billingPlan?: SuperwallBillingPlan;
};

/**
 * A slot object, the store product identifier as shorthand, or one
 * identifier per platform.
 */
export type SuperwallProductSlotInput = string | SuperwallProductSlot | SuperwallPlatformProductIds;

export const isPlatformProductIds = (
  input: SuperwallProductSlotInput,
): input is SuperwallPlatformProductIds =>
  typeof input === "object" && input !== null && !("productId" in input);

const platformIdsOf = (input: SuperwallPlatformProductIds): string[] =>
  SUPERWALL_PLATFORMS.map((platform) => input[platform]).filter(
    (id): id is string => typeof id === "string",
  );

export const productIdFor = (
  input: SuperwallProductSlotInput,
  platform?: SuperwallPlatform,
): string | undefined => {
  if (typeof input === "string") return input;
  if (!isPlatformProductIds(input)) return input.productId;
  if (platform !== undefined) return input[platform];
  return platformIdsOf(input)[0];
};

export const productIdsOf = (input: SuperwallProductSlotInput): string[] => {
  if (typeof input === "string") return [input];
  if (isPlatformProductIds(input)) return [...new Set(platformIdsOf(input))];
  return [input.productId].filter((id): id is string => typeof id === "string");
};

export const billingPlanFor = (
  input: SuperwallProductSlotInput,
): SuperwallBillingPlan | undefined => {
  if (typeof input === "string") return undefined;
  const plan: unknown = input.billingPlan;
  if (plan === undefined) return undefined;
  const known = SUPERWALL_BILLING_PLANS.find((candidate) => candidate === plan);
  if (known === undefined) {
    throw new Error(
      `billingPlan must be one of ${SUPERWALL_BILLING_PLANS.map((value) => `"${value}"`).join(", ")}, got ${JSON.stringify(plan)}.`,
    );
  }
  return known;
};
