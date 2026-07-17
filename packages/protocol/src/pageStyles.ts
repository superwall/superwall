import { z } from "zod";

export type TCSSPropertyName =
  | "color"
  | "background-color"
  | "border-color"
  | "border-top-color"
  | "border-bottom-color"
  | "border-right-color"
  | "border-left-color"
  | "text-shadow"
  | "box-shadow";

export type TCSSPropertyLabel =
  | "color"
  | "backgroundColor"
  | "borderColor"
  | "borderTopColor"
  | "borderBottomColor"
  | "borderRightColor"
  | "borderLeftColor"
  | "textShadow"
  | "boxShadow";

export const CSSPropertyEnum = z.enum([
  "color",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderBottomColor",
  "borderRightColor",
  "borderLeftColor",
  "textShadow",
  "boxShadow",
]);

export const PageStyle = z.object({
  from: z.string(),
  to: z.string(),
  property: CSSPropertyEnum,
});

export type TPageStyle = z.infer<typeof PageStyle>;

export const PageStyles = z.array(PageStyle);

export type TPageStyles = z.infer<typeof PageStyles>;
