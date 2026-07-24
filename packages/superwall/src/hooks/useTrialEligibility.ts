import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type UseTrialEligibilityResult = {
  /**
   * Whether the user is eligible for an introductory offer. `undefined`
   * until the SDK signals eligibility (or the config forces it).
   */
  eligible?: boolean;
};

/**
 * Introductory-offer eligibility, so trial UI ("Start your 7-day free
 * trial") only shows to eligible users. Per-product trial data lives on
 * `product.variables` (`trialPeriodDays`, `trialPeriodText`,
 * `trialPeriodEndDate`).
 */
export const useTrialEligibility = (): UseTrialEligibilityResult => useSuperwallSnapshot().trial;
