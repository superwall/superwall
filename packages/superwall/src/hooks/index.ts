export interface SuperwallProducts {}

export interface SuperwallStripeProducts {}

export type ProductReference = keyof SuperwallProducts extends never
  ? string
  : Extract<keyof SuperwallProducts, string>;

export type StripeProductReference = keyof SuperwallProducts extends never
  ? string
  : Extract<keyof SuperwallStripeProducts, string>;

export { createSuperwall } from "../provider/create";
export { useSuperwallSession } from "../provider/context";
export * from "./useActions";
export * from "./useColorScheme";
export * from "./useDevice";
export * from "./useHaptics";
export * from "./useProducts";
export * from "./usePurchase";
export * from "./useSuperwallEvent";
export * from "./useSuperwallSnapshot";
export * from "./useTranslation";
export * from "./useTrialEligibility";
export * from "./useVariables";
