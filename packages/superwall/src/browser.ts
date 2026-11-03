export type SuperwallInAppBrowser =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "snapchat"
  | "pinterest"
  | "linkedin"
  | "twitter"
  | "wechat"
  | "line";

export type SuperwallBrowser =
  | SuperwallInAppBrowser
  | "safari"
  | "chrome"
  | "firefox"
  | "edge"
  | "samsung"
  | "opera";

/** The browser showing the page, read from its user agent. */
export type SuperwallHostDetails = {
  /**
   * The browser's name: an app's own in-app browser (`"instagram"`,
   * `"facebook"`, `"tiktok"`, `"snapchat"`, `"pinterest"`, `"linkedin"`,
   * `"twitter"`, `"wechat"`, `"line"`) or a regular one (`"safari"`,
   * `"chrome"`, `"firefox"`, `"edge"`, `"samsung"`, `"opera"`). `undefined`
   * inside an app's own paywall (the native SDKs) or for a browser it does not
   * recognize.
   */
  browser: SuperwallBrowser | undefined;
  /** `true` when `browser` is an app's in-app browser rather than a regular one. Defaults to `false`. */
  inAppBrowser: boolean;
};

type Rule = readonly [name: SuperwallBrowser, pattern: RegExp];

const IN_APP_BROWSERS: ReadonlyArray<Rule> = [
  ["instagram", /\bInstagram\b/],
  ["facebook", /\bFBAN\/|\bFBAV\/|\bFB_IAB\b|\bFBIOS\b/],
  ["tiktok", /musical_ly|BytedanceWebview|\bTikTok\b/i],
  ["snapchat", /\bSnapchat\b/],
  ["pinterest", /\bPinterest\b/],
  ["linkedin", /\bLinkedInApp\b/],
  ["twitter", /\bTwitter\b/],
  ["wechat", /\bMicroMessenger\b/],
  ["line", /\bLine\//],
];

const BROWSERS: ReadonlyArray<Rule> = [
  ["edge", /\bEdg(?:e|iOS|A)?\//],
  ["opera", /\bOPR\/|\bOPiOS\//],
  ["samsung", /\bSamsungBrowser\//],
  ["firefox", /\bFirefox\/|\bFxiOS\//],
  ["chrome", /\bChrome\/|\bCriOS\//],
  ["safari", /\bVersion\/[\d.]+.*\bSafari\//],
];

const match = (rules: ReadonlyArray<Rule>, userAgent: string) =>
  rules.find(([, pattern]) => pattern.test(userAgent))?.[0];

export const hostDetailsOf = (userAgent: string): SuperwallHostDetails => {
  const inApp = match(IN_APP_BROWSERS, userAgent);
  if (inApp) return { browser: inApp, inAppBrowser: true };
  return { browser: match(BROWSERS, userAgent), inAppBrowser: false };
};

export const hostDetails = (): SuperwallHostDetails =>
  hostDetailsOf(typeof navigator === "undefined" ? "" : (navigator.userAgent ?? ""));
