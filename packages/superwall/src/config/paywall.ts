import type { SuperwallConfig, SuperwallMockOptions } from "@superwall/runtime";
import type { VariablesSchema } from "./variables";

export type PaywallDefinition = Partial<SuperwallConfig> & {
  /** Experiment knobs the dashboard can override per variant. */
  variables?: VariablesSchema;
  /**
   * Simulation overrides for the mock SDK host: real prices, purchase
   * outcomes, device variables, trial eligibility. These ship inside the
   * snapshot but never engage when a real SDK host is present — a webview
   * always provides its own data.
   */
  preview?: SuperwallMockOptions;
};

/** Declares one paywall's contract — products, experiment variables, preview. */
export const definePaywall = <TDefinition extends PaywallDefinition>(
  definition: TDefinition,
): TDefinition => definition;
