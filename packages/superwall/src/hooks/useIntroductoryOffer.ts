import { useSuperwallSnapshot } from "./useSuperwallSnapshot";

export type UseIntroductoryOfferResult = {
  /**
   * Whether the user is eligible for an introductory offer. `undefined`
   * until the SDK signals eligibility (or the config forces it).
   */
  eligible?: boolean;
};

/**
 * Introductory-offer eligibility, the paywall's `hasIntroductoryOffer`, so
 * trial copy ("Start your 7-day free trial") only shows to eligible users.
 * Per-product offer data lives on `product.variables` (`trialPeriodDays`,
 * `trialPeriodText`, `trialPeriodEndDate`).
 */
export const useIntroductoryOffer = (): UseIntroductoryOfferResult =>
  useSuperwallSnapshot().introductoryOffer;
