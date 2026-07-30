import type { SuperwallConfig } from "@superwall/runtime";
import type { Transition } from "../navigation/index";

export type PaywallDefinition = Partial<SuperwallConfig> & {
  /**
   * What this paywall is called on Superwall. Directory names carry the
   * restrictions of a URL segment, so they make poor labels once a dashboard
   * holds dozens of them — set a real name here and the directory stays an
   * identifier. Defaults to the directory name, title-cased.
   */
  name?: string;
  /**
   * Default transition for every route. A route's own
   * `export const transition` overrides it, and the call site overrides both.
   */
  transition?: Transition;
};

export const definePaywall = <TDefinition extends PaywallDefinition>(
  definition: TDefinition,
): TDefinition => definition;
