export type SuperwallPresentationStyle =
  | "fullscreen"
  | "modal"
  | "push"
  | "drawer"
  | "popup"
  | "noAnimation";

export type SuperwallPresentationConfig = {
  /** How the native SDK presents the paywall. Default: `"fullscreen"`. */
  style?: SuperwallPresentationStyle;
  /**
   * Drawer geometry, as percentages of the screen and points. Only read when
   * style is "drawer". Default: `{ height: 70, cornerRadius: 15 }`.
   */
  drawer?: { height?: number; cornerRadius?: number };
  /**
   * Popup geometry, as percentages of the screen and points. Only read when
   * style is "popup". Default: `{ width: 80, height: 60, cornerRadius: 15 }`.
   */
  popup?: { width?: number; height?: number; cornerRadius?: number };
};
