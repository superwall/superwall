/**
 * A paywall's background color. The string shorthand sets light mode; the
 * object form adds a dark-mode color. Native SDKs paint it behind the webview
 * (and derive the loading spinner from it), and the web document paints it as
 * the page background — so the color a shopper sees while the paywall loads
 * matches the color it settles on.
 */
export type SuperwallBackgroundConfig = string | { light: string; dark?: string };

export type ResolvedBackground = { light: string; dark?: string };

export const backgroundOf = (
  background: SuperwallBackgroundConfig | undefined,
): ResolvedBackground | undefined => {
  if (background === undefined) return undefined;
  if (typeof background === "string") {
    const light = background.trim();
    return light === "" ? undefined : { light };
  }
  const light = background.light?.trim();
  if (!light) return undefined;
  const dark = background.dark?.trim();
  return dark ? { light, dark } : { light };
};
