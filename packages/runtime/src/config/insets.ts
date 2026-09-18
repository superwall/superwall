/**
 * One edge of the padding the framework puts around every page:
 * `"safe-area"` (the device's safe area, floored per platform and
 * presentation), `"none"` (flush to the edge), a number of pixels, or any
 * CSS length.
 */
export type SuperwallInsetSide = "safe-area" | "none" | number | string;

/**
 * What every page is padded with. One value applies to all four edges; the
 * object form sets edges individually and leaves the rest at `"safe-area"`.
 */
export type SuperwallInsetsConfig =
  | SuperwallInsetSide
  | {
      /** Default: `"safe-area"`. */
      top?: SuperwallInsetSide;
      /** Default: `"safe-area"`. */
      right?: SuperwallInsetSide;
      /** Default: `"safe-area"`. */
      bottom?: SuperwallInsetSide;
      /** Default: `"safe-area"`. */
      left?: SuperwallInsetSide;
    };

export const INSET_EDGES = ["top", "right", "bottom", "left"] as const;

export type InsetEdge = (typeof INSET_EDGES)[number];

export type ResolvedInsets = Record<InsetEdge, string | undefined>;

const lengthOf = (side: SuperwallInsetSide | undefined): string | undefined => {
  if (side === undefined || side === "safe-area") return undefined;
  if (side === "none") return "0px";
  if (typeof side === "number") return `${side}px`;
  const length = side.trim();
  return length === "" ? undefined : length;
};

export const insetsOf = (insets: SuperwallInsetsConfig | undefined): ResolvedInsets => {
  if (insets === undefined || typeof insets !== "object") {
    const all = lengthOf(insets);
    return { top: all, right: all, bottom: all, left: all };
  }
  return {
    top: lengthOf(insets.top),
    right: lengthOf(insets.right),
    bottom: lengthOf(insets.bottom),
    left: lengthOf(insets.left),
  };
};
