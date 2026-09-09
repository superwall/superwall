import type { SuperwallConfig, SuperwallPlatform } from "@superwall/runtime";
import type { StripeProductReference } from "../hooks";
import type { Transition } from "../navigation/index";

export type PaywallDefinition = SuperwallConfig<string, StripeProductReference> & {
  /**
   * The platforms this paywall is pushed to. The project binds one Superwall
   * app per platform in `superwall.lock`, and one directory becomes one
   * dashboard paywall per platform listed, each with its own versions.
   * Required once the project pushes to more than one platform; with a
   * single one it may be omitted.
   */
  platforms?: readonly SuperwallPlatform[];
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
  /**
   * Keep the route stack and every `useQueryState` value in the page URL, so
   * a flow resumes from any link — after a reload, in the OS browser after an
   * in-app one, or back from hosted checkout. Defaults to on when `checkout`
   * is set. Only applies to web builds.
   */
  queryState?: boolean;
};

export const definePaywall = <TDefinition extends PaywallDefinition>(
  definition: TDefinition,
): TDefinition => definition;
