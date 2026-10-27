import type {
  SuperwallConfig,
  SuperwallPlatform,
  SuperwallTeleportConfig,
} from "@superwall/runtime";
import type { ProductReference, StripeProductReference, SuperwallProducts } from "../hooks";
import type { RouteName, Transition } from "../navigation/index";

type StoreProductReference = keyof SuperwallProducts extends never
  ? string
  : Exclude<ProductReference, StripeProductReference>;

export type PaywallDefinition = Omit<
  SuperwallConfig<string, StripeProductReference>,
  "teleport"
> & {
  /**
   * Continue the flow on the web when it is shown in an iOS app, and sell
   * Stripe products there: `true` for every default, or the options to
   * change. `route` names one of this paywall's routes and `fallbacks` maps a
   * Stripe product to a store product. Default: off. See
   * `SuperwallTeleportOptions`.
   */
  teleport?: SuperwallTeleportConfig<StripeProductReference, StoreProductReference, RouteName>;
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

type SellsOnWeb<TDefinition> = TDefinition extends { checkout: unknown }
  ? TDefinition extends { platforms: readonly (infer TPlatform)[] }
    ? "web" extends TPlatform
      ? true
      : false
    : true
  : false;

export type PostPurchaseFor<TDefinition> =
  SellsOnWeb<TDefinition> extends true ? unknown : { postPurchase?: "dismiss" | "stay" };

export const definePaywall = <TDefinition extends PaywallDefinition>(
  definition: TDefinition & PostPurchaseFor<TDefinition>,
): TDefinition => definition;
