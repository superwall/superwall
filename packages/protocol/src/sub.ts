import { z } from "zod";

const PropertyPrefix = z.enum(["default", "freeTrial"]);

const PropertyHidden = z.object({
  type: z.literal("hidden"),
  hidden: z.boolean(),
});

export type TPropertyHidden = z.infer<typeof PropertyHidden>;

const PropertyVideo = z.object({
  type: z.literal("video"),
  coverURL: z.string().nullable().optional(),
  videoURLs: z.array(
    z.object({
      url: z.string(),
    }),
  ),
});

export type TPropertyVideo = z.infer<typeof PropertyVideo>;

const PropertySrc = z.object({
  type: z.literal("src"),
  src: z.string(),
  srcSet: z.array(z.string()).optional(),
});

export type TPropertySrc = z.infer<typeof PropertySrc>;

const Style = z.object({
  property: z.string(),
  value: z.string(),
});

const Styles = z.array(Style);

const PropertyStyles = z.object({
  type: z.literal("styles"),
  styles: Styles,
});

export type TStyle = z.infer<typeof Style>;
export type TStyles = z.infer<typeof Styles>;
export type TPropertyStyles = z.infer<typeof PropertyStyles>;

const PropertyBackgroundImage = z.object({
  type: z.literal("backgroundImage"),
  backgroundImage: z.string().nullable().optional(),
  backgroundSize: z.string().nullable().optional(),
  backgroundRepeat: z.string().nullable().optional(),
  backgroundPosition: z.string().nullable().optional(),
  backgroundAttachment: z.string().nullable().optional(),
});

export type TPropertyBackgroundImage = z.infer<typeof PropertyBackgroundImage>;

const ClickBehaviorDoNothing = z.object({
  type: z.literal("do-nothing"),
});

const ClickBehaviorOpenURL = z.object({
  type: z.literal("open-url"),
  url: z.string(),
});

const ClickBehaviorOpenExternalURL = z.object({
  type: z.literal("open-url-external"),
  url: z.string(),
});

const ClickBehaviorOpenDeepLink = z.object({
  type: z.literal("open-deep-link"),
  link: z.string(),
});

const ClickBehaviorClose = z.object({
  type: z.literal("close"),
});

const ClickBehaviorRestore = z.object({
  type: z.literal("restore"),
});

const ClickBehaviorPurchase = z.object({
  type: z.literal("purchase"),
  product: z.union([z.literal("primary"), z.literal("secondary"), z.literal("tertiary")]),
});

const ClickBehaviorCustom = z.object({
  type: z.literal("custom"),
  data: z.string(),
});

const ClickBehaviorSetAttribute = z.object({
  type: z.literal("set-attribute"),
  attributes: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});

export const ClickBehavior = z.discriminatedUnion("type", [
  ClickBehaviorDoNothing,
  ClickBehaviorOpenURL,
  ClickBehaviorOpenExternalURL,
  ClickBehaviorOpenDeepLink,
  ClickBehaviorClose,
  ClickBehaviorRestore,
  ClickBehaviorPurchase,
  ClickBehaviorCustom,
  ClickBehaviorSetAttribute,
]);

export type TClickBehavior = z.infer<typeof ClickBehavior>;

const PropertyClickBehavior = z.object({
  type: z.literal("click-behavior"),
  clickBehavior: ClickBehavior,
});

export type TPropertyClickBehavior = z.infer<typeof PropertyClickBehavior>;

/**
 * Purchase click behaviors are enumerated per product slot (primary,
 * secondary, tertiary) so the editor can validate them as a form.
 */
const ClickBehaviorPurchasePrimary = z.object({
  type: z.literal("purchase-Primary"),
  product: z.string(),
});

const ClickBehaviorPurchaseSecondary = z.object({
  type: z.literal("purchase-Secondary"),
  product: z.string(),
});

const ClickBehaviorPurchaseTertiary = z.object({
  type: z.literal("purchase-Tertiary"),
  product: z.string(),
});

export const ClickBehaviorEditorSchema = z.discriminatedUnion("type", [
  ClickBehaviorDoNothing,
  ClickBehaviorOpenURL,
  ClickBehaviorOpenExternalURL,
  ClickBehaviorOpenDeepLink,
  ClickBehaviorClose,
  ClickBehaviorRestore,
  ClickBehaviorCustom,
  ClickBehaviorSetAttribute,
  ClickBehaviorPurchasePrimary,
  ClickBehaviorPurchaseSecondary,
  ClickBehaviorPurchaseTertiary,
]);

export type TClickBehaviorEditorSchema = z.infer<typeof ClickBehaviorEditorSchema>;

const PropertyClickBehaviorEditorSchema = z.object({
  type: z.literal("click-behavior"),
  clickBehavior: ClickBehaviorEditorSchema,
});

export type TPropertyClickBehaviorEditorSchema = z.infer<typeof PropertyClickBehaviorEditorSchema>;

export const ClickBehaviorAll = z.discriminatedUnion("type", [
  ClickBehaviorDoNothing,
  ClickBehaviorOpenURL,
  ClickBehaviorOpenExternalURL,
  ClickBehaviorOpenDeepLink,
  ClickBehaviorClose,
  ClickBehaviorRestore,
  ClickBehaviorCustom,
  ClickBehaviorSetAttribute,
  ClickBehaviorPurchase,
  ClickBehaviorPurchasePrimary,
  ClickBehaviorPurchaseSecondary,
  ClickBehaviorPurchaseTertiary,
]);

export type TClickBehaviorAll = z.infer<typeof ClickBehaviorAll>;

const PropertyClickBehaviorAll = z.object({
  type: z.literal("click-behavior"),
  clickBehavior: ClickBehaviorAll,
});

export type TPropertyClickBehaviorAll = z.infer<typeof PropertyClickBehaviorAll>;

export const SubPropertyValue = z.union([
  PropertyHidden,
  PropertySrc,
  PropertyStyles,
  PropertyVideo,
  PropertyClickBehavior,
  PropertyBackgroundImage,
]);

export const PropertyAssets = z.union([PropertySrc, PropertyVideo]);

export type TPropertyAssets = z.infer<typeof PropertyAssets>;

export type TSubPropertyValue = z.infer<typeof SubPropertyValue>;

export const SubProperty = z.object({
  prefix: PropertyPrefix,
  property: SubPropertyValue,
});

export type TSubProperty = z.infer<typeof SubProperty>;

export type TWrappedTPropertyClickBehavior = z.infer<typeof SubProperty> & {
  property: { type: 'click-behavior"' };
};

/**
 *
 * {
 *    "key": "title",
 *    "value": "Free Trial",
 *    "tagName": "h1",
 *    "properties": [
 *      {
 *        "prefix": "default",
 *        "value": {
 *         "type": "src",
 *         "src": "https://example.com/image.png"
 *       }
 *      }
 *     ]
 * }
 *
 *
 */

export const properties = z.array(SubProperty);

export const SubSchema = z.object({
  key: z.string(),
  value: z.string(),
  freeTrialValue: z.string().optional(),
  // If this is set, we don't template the innerHTML
  skipInnerHTML: z.boolean().optional(),
  // If this is set, we don't every touch this element
  // ignoreDOM: z.boolean().optional(),
  // The _actual_ tag name of the element
  tagName: z.string().optional(),

  // What type the tag plays in the paywall,
  // used for controlling what type of editor
  // we setup
  subType: z.enum(["img", "video", "var"]).optional(),

  properties: properties.optional(),
  initialStyles: z.object({}).passthrough().optional(),

  // Used to break memoization in the editor
  revision: z.number().optional(),
});

export const SubsSchema = z.array(SubSchema);

export type Sub = z.infer<typeof SubSchema>;

// This is the schema of substitutionso once paywall-js has rendered them,
// they don't have any notion of free trial or default.

export const RenderedSubsSchema = z.object({
  key: z.string(),
  // Null implies that that value should be removed from the DOM
  // undefined implies that the value should be left alone
  value: z.string().nullable().optional(),
  skipInnerHTML: z.boolean().optional(),
  properties: z.array(properties),
});

export type TRenderedSubsSchema = z.infer<typeof RenderedSubsSchema>;
